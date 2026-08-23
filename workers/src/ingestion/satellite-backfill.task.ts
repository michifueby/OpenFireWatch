/**
 * Satellite archive backfill — replaying years of detections through the
 * same rule the live system applies, so the incident register can say for a
 * fire in 2019 whether this system WOULD have alarmed.
 *
 * Triggered by an operator (POST /api/backfill/satellite), one run at a time,
 * on its own queue so a replay of a decade never delays a live cycle. For the
 * requested range it:
 *
 *   1. asks FIRMS which products hold which dates, and plans the requests
 *      (satellite-backfill.plan.ts — five-day windows, stream chosen per day);
 *   2. makes sure the weather of that period is in zone_weather_history,
 *      fetching the reanalysis archive where a zone is short of it;
 *   3. fetches each window, pairs every detection with the weather AT ITS
 *      HOUR — the conditions of the zone it fell in, or of the nearest zone
 *      when it fell outside all of them, exactly as the live cycle pairs a
 *      detection with one area-wide reading;
 *   4. publishes each as a detection report marked `ingestion: 'backfill'`,
 *      at low priority so live reports still jump the queue.
 *
 * The evaluation service does the rest: same rule, same tables, same
 * de-duplication — and, because of the mark, no alarm, no page, no pulsing
 * marker and no substitution of today's sensor readings for a day long gone.
 *
 * Progress is written to backfill_runs as it goes, so an operator watching the
 * panel sees windows tick past, and a run interrupted by a restart shows
 * exactly where it stopped rather than vanishing.
 */

import { Job, JobsOptions } from 'bullmq';
import { instanceToPlain, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Pool } from 'pg';

import { fetchArchive } from '../clients/archive.client';
import {
  fetchFirmsArea,
  fetchFirmsAvailability,
  RawDetection,
} from '../clients/firms.client';
import { listZonePoints, resolveMonitoringArea } from '../clients/monitoring-area';
import { config } from '../config';
import { DetectionReportDto } from '../dto/detection-report.dto';
import { countWeatherDays, storeWeatherHours } from './history-backfill.task';
import { detectionReportsQueue } from './ingest.task';
import {
  BackfillRequest,
  coverageGaps,
  daysBetween,
  planBackfill,
} from './satellite-backfill.plan';

/** What the API enqueues. */
export interface SatelliteBackfillJob {
  runId: number;
  from: string;
  to: string;
}

const pool = new Pool({
  host: config.POSTGRES_HOST,
  port: config.POSTGRES_PORT,
  database: config.POSTGRES_DB,
  user: config.POSTGRES_USER,
  password: config.POSTGRES_PASSWORD,
  max: 2,
});

/**
 * Live reports are enqueued without a priority (BullMQ treats that as the
 * most urgent). Anything above zero waits behind them, which is what a
 * replay of history should do.
 */
const BACKFILL_REPORT_OPTIONS: JobsOptions = { priority: 10 };


export async function backfillSatellite(job: Job<SatelliteBackfillJob>): Promise<void> {
  const { runId, from, to } = job.data;
  await setStatus(runId, 'running', { started_at: new Date() });

  try {
    // -- 1) Plan -------------------------------------------------------------
    const families = config.FIRMS_BACKFILL_SOURCES.split(',').map((s) => s.trim()).filter(Boolean);
    const availability = await fetchFirmsAvailability();
    const requests = planBackfill(from, to, families, availability);
    const gaps = coverageGaps(from, to, requests);
    await pool.query(
      `UPDATE backfill_runs
          SET requests_total = $2, coverage_gaps = $3::jsonb, sources = $4
        WHERE id = $1;`,
      [runId, requests.length, JSON.stringify(gaps), requests.map((r) => r.source).filter((v, i, a) => a.indexOf(v) === i).join(',')],
    );
    console.log(
      `[backfill #${runId}] ${from} → ${to}: ${requests.length} request(s), ` +
        `${gaps.length} coverage gap(s)`,
    );

    // -- 2) Weather for the period -------------------------------------------
    await ensureWeatherHistory(from, to, job);

    // -- 3+4) Fetch, pair, publish ------------------------------------------------
    const area = await resolveMonitoringArea();
    let found = 0;
    let queued = 0;
    let done = 0;

    for (const request of requests) {
      const detections = await fetchWithPacing(request, area.bbox);
      found += detections.length;
      queued += await publishBackfilled(detections, job);
      done += 1;
      await pool.query(
        `UPDATE backfill_runs
            SET requests_done = $2, detections_found = $3, reports_queued = $4
          WHERE id = $1;`,
        [runId, done, found, queued],
      );
    }

    await setStatus(runId, 'done', { finished_at: new Date() });
    console.log(
      `[backfill #${runId}] complete — ${found} detection(s) found, ${queued} report(s) queued`,
    );
  } catch (error) {
    await setStatus(runId, 'failed', {
      finished_at: new Date(),
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Make sure every active zone has the reanalysis weather for the range. A
 * zone short of it is fetched in one call — the archive client takes a whole
 * date range at once — and stored through the same writer the nightly
 * history job uses.
 */
async function ensureWeatherHistory(from: string, to: string, job: Job): Promise<void> {
  const zones = await listZonePoints();
  const days = daysBetween(from, to) + 1;

  for (const zone of zones) {
    // Asked per day: the nightly history job stops six days short of today,
    // so a range that ends recently is complete except for its tail — and a
    // total-hours check passes that with room to spare. The refetch covers
    // the whole range because the insert is idempotent; only the missing
    // hours are actually written.
    const covered = await countWeatherDays(zone.id, from, to);
    if (covered >= days) continue;
    await job.log(
      `Weather for zone ${zone.id}: ${covered}/${days} day(s) on record — fetching ${from}–${to}`,
    );
    try {
      const hours = await fetchArchive(zone.latitude, zone.longitude, from, to);
      const stored = await storeWeatherHours(zone.id, hours);
      await job.log(`Weather for zone ${zone.id}: ${stored} hour(s) added`);
    } catch (error) {
      // A zone without weather can still be replayed for detection-gated
      // hazards; the phosphorus rule will hold its verdicts back and say why.
      await job.log(`Weather for zone ${zone.id} unavailable: ${(error as Error).message}`);
    }
  }
}

/** One FIRMS request, paced, with the quota error turned into a wait. */
async function fetchWithPacing(request: BackfillRequest, bbox: string): Promise<RawDetection[]> {
  for (let attempt = 1; ; attempt++) {
    await sleep(config.FIRMS_BACKFILL_PACE_MS);
    try {
      return await fetchFirmsArea(request.source, bbox, request.dayRange, request.startDate);
    } catch (error) {
      const message = (error as Error).message;
      // FIRMS says this in words when the 10-minute budget is spent. Waiting
      // it out is the whole answer; failing the run would lose an hour's work.
      if (/transaction limit|exceeded/i.test(message) && attempt <= 12) {
        console.warn(`[backfill] FIRMS quota hit — pausing 60 s (attempt ${attempt})`);
        await sleep(60_000);
        continue;
      }
      throw error;
    }
  }
}

/** Pair each detection with the weather at its hour and publish it. */
async function publishBackfilled(detections: RawDetection[], job: Job): Promise<number> {
  const reports: Array<{ report: DetectionReportDto; raw: RawDetection }> = [];

  for (const raw of detections) {
    const weather = await weatherAt(raw.longitude, raw.latitude, raw.acquiredAt);
    if (!weather) {
      await job.log(`No weather on record for ${raw.acquiredAt} — detection skipped`);
      continue;
    }
    const report = plainToInstance(DetectionReportDto, {
      detection: { ...raw },
      weather,
      ingestion: 'backfill',
    } satisfies Record<keyof DetectionReportDto, unknown>);

    const errors = await validate(report, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
    if (errors.length > 0) {
      await job.log(`Skipped invalid archive row: ${errors.map(String).join('; ')}`);
      continue;
    }
    reports.push({ report, raw });
  }

  if (reports.length === 0) return 0;

  // Same deterministic ids as the live cycle, so a window replayed twice —
  // or a day the live cycle already saw — enqueues nothing new.
  await detectionReportsQueue.addBulk(
    reports.map(({ report, raw }) => ({
      name: 'detection-report',
      data: instanceToPlain(report),
      opts: {
        ...BACKFILL_REPORT_OPTIONS,
        jobId: `report|${raw.source}|${raw.latitude}|${raw.longitude}|${raw.acquiredAt.replaceAll(':', '.')}`,
      },
    })),
  );
  return reports.length;
}

/**
 * The weather a historical detection is evaluated against: the reanalysis
 * hour containing the acquisition time, from the zone the point lies in —
 * or, outside every zone, from whichever zone is nearest. The live cycle
 * pairs every detection with one area-wide reading; this is the same idea
 * with the benefit of hindsight.
 */
async function weatherAt(
  longitude: number,
  latitude: number,
  acquiredAt: string,
): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query<{
    observed_at: Date;
    temperature_c: number;
    soil_moisture_pct: number;
  }>(
    `SELECT h.observed_at, h.temperature_c, h.soil_moisture_pct
       FROM zone_weather_history h
       JOIN high_risk_zones z ON z.id = h.zone_id
      WHERE h.observed_at <= $3::timestamptz
        AND $3::timestamptz < h.observed_at + interval '1 hour'
      ORDER BY ST_Contains(z.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)) DESC,
               z.geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
      LIMIT 1;`,
    [longitude, latitude, acquiredAt],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    temperatureC: row.temperature_c,
    soilMoisturePct: row.soil_moisture_pct,
    observedAt: row.observed_at.toISOString(),
  };
}

async function setStatus(
  runId: number,
  status: 'running' | 'done' | 'failed',
  extra: { started_at?: Date; finished_at?: Date; error?: string },
): Promise<void> {
  await pool.query(
    `UPDATE backfill_runs
        SET status = $2,
            started_at = COALESCE($3, started_at),
            finished_at = COALESCE($4, finished_at),
            error = COALESCE($5, error)
      WHERE id = $1;`,
    [runId, status, extra.started_at ?? null, extra.finished_at ?? null, extra.error ?? null],
  );
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function closeBackfillPool(): Promise<void> {
  await pool.end();
}
