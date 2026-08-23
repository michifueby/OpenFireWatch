/**
 * The real-data ingestion cycle (BullMQ cron job, producer side).
 *
 * One cycle, three external calls, zero mocks:
 *   1. GeoSphere Austria TAWES  → current TL (air temp) + RF (rel. humidity)
 *   2. Open-Meteo               → topsoil moisture at the area centroid
 *   3. NASA FIRMS (LANCE)       → hotspot CSV for the monitored bounding box
 *
 * Every hotspot is CORRELATED with the current ground conditions, packed
 * into a strictly-typed DetectionReportDto, validated with class-validator,
 * and published to the Redis/BullMQ broker for the NestJS evaluation layer.
 *
 * Error-handling contract (the worker process must NEVER crash):
 *   - Any external API failure throws a descriptive Error → BullMQ retries
 *     THIS JOB with exponential backoff; after the final attempt the job is
 *     copied to the dead letter queue by the handler in index.ts. The worker
 *     process itself keeps running and the next scheduled cycle still fires.
 *   - A single malformed CSV row is logged and skipped — one bad row must
 *     never discard a whole satellite pass.
 */

import { Job, JobsOptions, Queue } from 'bullmq';
import { instanceToPlain, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { fetchFirmsArea, RawDetection } from '../clients/firms.client';
import { fetchStationWeather } from '../clients/geosphere.client';
import { resolveMonitoringArea } from '../clients/monitoring-area';
import { fetchTopsoilMoisturePct } from '../clients/soil-moisture.client';
import { BUS, FIRMS_POLL_SOURCES, config } from '../config';
import { DetectionReportDto } from '../dto/detection-report.dto';
import { createRedisConnection } from '../redis';

const REPORT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { count: 1_000 }, // keep a small audit window
  removeOnFail: false, // failed jobs stay inspectable
};

/** Producer handle for the validated detection-reports queue. */
export const detectionReportsQueue = new Queue(BUS.DETECTION_REPORTS_QUEUE, {
  connection: createRedisConnection(),
  defaultJobOptions: REPORT_JOB_OPTIONS,
});

/** BullMQ processor for the recurring `ingest-firms` job. */
export async function ingestDetections(job: Job): Promise<number> {
  job.log(`Ingestion cycle started (attempt ${job.attemptsMade + 1})`);

  // --- 0) Which area are we watching? -----------------------------------------
  // Derived from the active hazard zones unless FIRMS_AREA overrides it, and
  // re-resolved every cycle so zone changes take effect without a restart.
  const area = await resolveMonitoringArea();
  // stdout, not job.log(): `docker compose logs workers` is where operators
  // actually look, and BullMQ trims per-job logs with removeOnComplete.
  console.log(
    `[ingest] area [${area.bbox}] (${area.origin}) — resolved for this cycle`,
  );

  // --- 1+2) Ground truth, fetched ONCE per cycle ------------------------------
  // Sequential on purpose: if the weather side is down there is no point in
  // hitting FIRMS — we cannot correlate, so we fail fast into the retry path.
  const station = await fetchStationWeather(config.GEOSPHERE_STATION_ID);
  const soilMoisturePct = await fetchTopsoilMoisturePct(
    area.centroid.latitude,
    area.centroid.longitude,
  );

  // Publish what we just measured, whether or not any hotspot follows. The
  // conditions are useful in their own right: they say how close each zone is
  // to its thresholds *before* anything ignites.
  await publishConditions({
    observedAt: station.observedAt,
    temperatureC: station.temperatureC,
    relativeHumidityPct: station.relativeHumidityPct,
    windSpeedKmh: station.windSpeedKmh,
    windDirectionDeg: station.windDirectionDeg,
    soilMoisturePct,
    stationId: station.stationId,
    area: area.bbox,
    areaOrigin: area.origin,
    cycleAt: new Date().toISOString(),
  });

  // --- 3) Satellite hotspots (streamed CSV), once per instrument ---------------
  // Sequentially rather than in parallel: FIRMS meters by transactions, and
  // three polite requests read better in a rate-limit log than three at once.
  const detections: RawDetection[] = [];
  const failures: string[] = [];
  for (const source of FIRMS_POLL_SOURCES) {
    try {
      detections.push(
        ...(await fetchFirmsArea(source, area.bbox, config.FIRMS_LOOKBACK_DAYS)),
      );
    } catch (error) {
      // One instrument being unavailable must not blind the others.
      failures.push(`${source}: ${(error as Error).message}`);
      job.log(`Source ${source} failed: ${(error as Error).message}`);
    }
  }
  // Every source failing is an outage, not an empty sky — fail into the retry
  // path rather than reporting "no hotspots", which is this system's most
  // dangerous possible lie.
  if (failures.length === FIRMS_POLL_SOURCES.length) {
    throw new Error(`No FIRMS source could be polled — ${failures.join('; ')}`);
  }

  if (detections.length === 0) {
    console.log(
      `[ingest] no hotspots in the monitored area (${FIRMS_POLL_SOURCES.length} source(s), ` +
        `${config.FIRMS_LOOKBACK_DAYS}d) — TL ${station.temperatureC}°C, ` +
        `RF ${station.relativeHumidityPct}%, soil ${soilMoisturePct}%`,
    );
    return 0;
  }

  // --- 4) Correlate → validate → publish ----------------------------------------
  const validReports: Array<{ report: DetectionReportDto; raw: RawDetection }> = [];
  let skipped = 0;

  for (const raw of detections) {
    const report = plainToInstance(DetectionReportDto, {
      detection: { ...raw },
      weather: {
        temperatureC: station.temperatureC, // TL
        relativeHumidityPct: station.relativeHumidityPct, // RF
        soilMoisturePct,
        windSpeedKmh: station.windSpeedKmh,
        observedAt: station.observedAt,
      },
      ingestion: 'live',
    } satisfies Record<keyof DetectionReportDto, unknown>);

    const errors = await validate(report, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
    if (errors.length > 0) {
      // Robustness: log-and-skip. One corrupt row (sensor glitch, format
      // drift) must not invalidate the rest of the satellite pass.
      skipped += 1;
      job.log(`Skipped invalid detection row: ${errors.map(String).join('; ')}`);
      continue;
    }
    validReports.push({ report, raw });
  }

  // Deterministic jobIds keyed on (source, pixel, acquisition time) give
  // queue-level idempotency: re-polling the same pass enqueues nothing new.
  // (BullMQ forbids ":" in custom job ids — hence "|" and "." separators.)
  await detectionReportsQueue.addBulk(
    validReports.map(({ report, raw }) => ({
      name: 'detection-report',
      data: instanceToPlain(report),
      opts: {
        jobId: `report|${raw.source}|${raw.latitude}|${raw.longitude}|${raw.acquiredAt.replaceAll(':', '.')}`,
      },
    })),
  );

  // Most of these are passes seen on an earlier cycle; the queue's job ids
  // and the database's unique constraint drop them, so the count below is
  // what was OFFERED, not what was new.
  console.log(
    `[ingest] published ${validReports.length}/${detections.length} detection reports ` +
      `(${skipped} skipped) from ${FIRMS_POLL_SOURCES.length} source(s) — ` +
      `TL ${station.temperatureC}°C, RF ${station.relativeHumidityPct}%, soil ${soilMoisturePct}%`,
  );
  return validReports.length;
}

/** Shared Redis handle for the conditions snapshot. */
const conditionsRedis = createRedisConnection();

/**
 * Store the latest ground conditions for the API to serve.
 *
 * Given a generous TTL of four polling intervals: long enough to survive a
 * couple of failed cycles, short enough that a genuinely stopped ingestion
 * makes the key disappear rather than leaving the UI showing stale weather
 * as though it were live.
 */
async function publishConditions(snapshot: Record<string, unknown>): Promise<void> {
  try {
    await conditionsRedis.set(
      BUS.CONDITIONS_KEY,
      JSON.stringify(snapshot),
      'EX',
      config.FIRMS_POLL_INTERVAL * 4,
    );
  } catch (error) {
    // Never let a reporting detail abort an ingestion cycle.
    console.warn(`[ingest] could not publish conditions: ${(error as Error).message}`);
  }
}

/** Release the handle during graceful shutdown. */
export async function closeConditionsRedis(): Promise<void> {
  await conditionsRedis.quit();
}
