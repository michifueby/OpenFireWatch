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

import { fetchFirmsDetections, RawDetection } from '../clients/firms.client';
import { fetchStationWeather } from '../clients/geosphere.client';
import { resolveMonitoringArea } from '../clients/monitoring-area';
import { fetchTopsoilMoisturePct } from '../clients/soil-moisture.client';
import { BUS, config } from '../config';
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

  // --- 3) Satellite hotspots (streamed CSV) ------------------------------------
  const detections = await fetchFirmsDetections(area.bbox);
  if (detections.length === 0) {
    console.log(
      `[ingest] no hotspots in the monitored area — TL ${station.temperatureC}°C, ` +
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
        windSpeedKmh: null,
        observedAt: station.observedAt,
      },
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

  console.log(
    `[ingest] published ${validReports.length}/${detections.length} detection reports ` +
      `(${skipped} skipped) — TL ${station.temperatureC}°C, RF ${station.relativeHumidityPct}%, ` +
      `soil ${soilMoisturePct}%`,
  );
  return validReports.length;
}
