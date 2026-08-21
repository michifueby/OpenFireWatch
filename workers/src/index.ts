/**
 * Worker service entrypoint (real-data ingestion, no mocks).
 *
 * Pipeline wiring (producer side of the domain logic):
 *
 *   [cron] ingest-firms  (every FIRMS_POLL_INTERVAL seconds)
 *     ├── Monitoring area: derived from the active hazard zones (ST_Extent)
 *     │   unless FIRMS_AREA overrides it — re-resolved every cycle
 *     ├── GeoSphere TAWES: current TL/RF at the configured station
 *     ├── Open-Meteo: topsoil moisture at the monitoring-area centroid
 *     └── NASA FIRMS: hotspot CSV (streamed) for the bounding box
 *           └─> correlate + validate → events.detection-reports
 *                 └─> consumed by the NestJS AnomalyEvaluationService
 *
 * Any job that exhausts its retries — or throws UnrecoverableError — is
 * copied (payload + failure reason) onto `dlq.ingestion` for inspection and
 * manual replay. The pipeline never silently drops data, and an external
 * API outage never crashes the process: the failed cycle retries with
 * exponential backoff while the schedule keeps ticking.
 */

import 'reflect-metadata'; // required by class-transformer/class-validator

import { Job, Queue, Worker } from 'bullmq';

import { BUS, config } from './config';
import {
  closeMonitoringAreaPool,
  resolveMonitoringArea,
} from './clients/monitoring-area';
import {
  closeConditionsRedis,
  detectionReportsQueue,
  ingestDetections,
} from './ingestion/ingest.task';
import { closeForecastRedis, refreshForecast } from './ingestion/forecast.task';
import { createRedisConnection } from './redis';
import { APP_VERSION, GIT_REVISION } from './version';

async function main(): Promise<void> {
  // --- Dead letter queue ------------------------------------------------------
  const deadLetterQueue = new Queue(BUS.DEAD_LETTER_QUEUE, {
    connection: createRedisConnection(),
  });

  /** Copy a permanently-failed job to the DLQ, preserving full context. */
  const moveToDeadLetter =
    (queueName: string) =>
    async (job: Job | undefined, error: Error): Promise<void> => {
      // Still retries left and not flagged unrecoverable → not dead yet.
      const unrecoverable = error.name === 'UnrecoverableError';
      if (!job || (!unrecoverable && job.attemptsMade < (job.opts.attempts ?? 1))) {
        return;
      }
      await deadLetterQueue.add('dead-letter', {
        sourceQueue: queueName,
        jobName: job.name,
        payload: job.data,
        error: error.message,
        attempts: job.attemptsMade,
        failedAt: new Date().toISOString(),
      });
      console.error(
        `[DLQ] ${queueName}/${job.name} failed permanently after ${job.attemptsMade} attempt(s): ${error.message}`,
      );
    };

  // --- Scheduled ingestion cycle -----------------------------------------------
  const ingestionQueue = new Queue(BUS.INGESTION_QUEUE, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: false,
    },
  });

  // Job schedulers are idempotent: upserting the same id updates the schedule
  // instead of duplicating it — safe across restarts and config changes.
  await ingestionQueue.upsertJobScheduler(
    'ingest-firms',
    { every: config.FIRMS_POLL_INTERVAL * 1_000 },
    { name: 'ingest-firms' },
  );
  // Defensive cleanup: schedulers persist in Redis, so retired ones from
  // earlier releases must be removed explicitly or they keep firing forever.
  for (const retired of ['poll-firms', 'simulate-detections']) {
    await ingestionQueue.removeJobScheduler(retired);
  }

  // Forecast refresh shares the queue but is its own scheduled job: it runs
  // on a different rhythm and must not delay a detection cycle.
  await ingestionQueue.upsertJobScheduler(
    'refresh-forecast',
    { every: config.FORECAST_POLL_INTERVAL * 1_000 },
    { name: 'refresh-forecast' },
  );

  const ingestionWorker = new Worker(
    BUS.INGESTION_QUEUE,
    async (job) =>
      job.name === 'refresh-forecast'
        ? refreshForecast(job)
        : ingestDetections(job),
    {
      connection: createRedisConnection(),
      concurrency: 1, // never two overlapping ingestion cycles
    },
  );
  ingestionWorker.on('failed', moveToDeadLetter(BUS.INGESTION_QUEUE));
  // Log-and-continue: a worker-level error (e.g. Redis blip) must not exit.
  ingestionWorker.on('error', (error) =>
    console.error(`Ingestion worker error: ${error.message}`),
  );

  // Resolve once at startup purely to report the effective configuration.
  // A failure here is informational — the scheduled cycle resolves it again
  // and will retry with backoff if the database is not ready yet.
  const area = await resolveMonitoringArea().catch((error: Error) => {
    console.warn(`Monitoring area not resolvable yet: ${error.message}`);
    return null;
  });
  console.log(
    `OpenFireWatch workers v${APP_VERSION} (${GIT_REVISION}) up — ` +
      `FIRMS ${config.FIRMS_SOURCE} every ${config.FIRMS_POLL_INTERVAL}s, ` +
      `weather from TAWES station ${config.GEOSPHERE_STATION_ID}, ` +
      `ignition forecast every ${config.FORECAST_POLL_INTERVAL}s, ` +
      (area
        ? `area [${area.bbox}] (${area.origin === 'zones' ? 'derived from active zones' : 'FIRMS_AREA override'})`
        : 'area pending (no active zones yet)'),
  );

  // --- Graceful shutdown (docker stop sends SIGTERM) ----------------------------
  const shutdown = async (): Promise<void> => {
    console.log('Shutting down workers gracefully...');
    await Promise.allSettled([
      ingestionWorker.close(),
      ingestionQueue.close(),
      detectionReportsQueue.close(),
      deadLetterQueue.close(),
      closeMonitoringAreaPool(),
      closeConditionsRedis(),
      closeForecastRedis(),
    ]);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error('Fatal worker startup error:', error);
  process.exit(1);
});
