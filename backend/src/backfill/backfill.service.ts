/**
 * BackfillService — operator-triggered replays of the satellite archive.
 *
 * The API owns the bookkeeping (a run, its range, its progress) and hands the
 * work to the workers over a dedicated queue; the workers own the fetching
 * and report back into the same row. Keeping the record here rather than in
 * BullMQ's own job state is deliberate: a queue is a transport, and a run
 * that finished last year should still be readable when someone asks "how
 * far back does the register actually see?".
 *
 * One run at a time. FIRMS rations requests per key, and two concurrent
 * replays would be racing each other for the same budget; refusing the second
 * with a clear message beats two runs limping.
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';

import { APP_CONFIG, AppConfig } from '../config/environment';
import { DatabaseService } from '../database/database.service';
import { redisOptions } from '../redis/redis.factory';

/** Must match the workers' BUS.BACKFILL_QUEUE. */
const BACKFILL_QUEUE = 'jobs.backfill';

/** The earliest day any supported product holds (VIIRS on Suomi NPP). */
export const ARCHIVE_BEGINS = '2012-01-20';
/** Longest range one run may cover — five seasons is plenty per click. */
export const MAX_RANGE_DAYS = 5 * 366;

export type BackfillStatus = 'queued' | 'running' | 'done' | 'failed';

export interface BackfillRun {
  id: number;
  status: BackfillStatus;
  from: string;
  to: string;
  /** Exact FIRMS products the plan used, once the workers have planned. */
  sources: string | null;
  requestsTotal: number | null;
  requestsDone: number;
  detectionsFound: number;
  reportsQueued: number;
  /** Days inside the range that no product covered — never "no fires". */
  coverageGaps: Array<{ from: string; to: string }>;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

@Injectable()
export class BackfillService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackfillService.name);
  private queue!: Queue;

  constructor(
    private readonly db: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
    this.queue = new Queue(BACKFILL_QUEUE, {
      connection: redisOptions(this.config, 'stream'),
      // One attempt: a replay is long and idempotent at the report level, so
      // re-running it is the operator's call, not the queue's.
      defaultJobOptions: { attempts: 1, removeOnComplete: { count: 50 }, removeOnFail: false },
    });
  }

  async list(): Promise<BackfillRun[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM backfill_runs ORDER BY created_at DESC LIMIT 50;`,
    );
    return rows.map(toRun);
  }

  /**
   * Record a run and hand it to the workers.
   *
   * The range is checked here so the operator hears about a problem in the
   * response, not in a worker log: inverted, in the future, before the
   * archive exists, or longer than one run should be.
   */
  async start(from: string, to: string): Promise<BackfillRun> {
    const today = new Date().toISOString().slice(0, 10);
    const spanDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

    if (spanDays < 0) throw new BadRequestException(`"from" (${from}) is after "to" (${to}).`);
    if (to > today) throw new BadRequestException(`"to" (${to}) lies in the future.`);
    if (from < ARCHIVE_BEGINS) {
      throw new BadRequestException(`The satellite archive begins on ${ARCHIVE_BEGINS}.`);
    }
    if (spanDays > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `One run covers at most ${MAX_RANGE_DAYS} days; split a longer range into several runs.`,
      );
    }

    const { rows: active } = await this.db.query<{ id: string }>(
      `SELECT id FROM backfill_runs WHERE status IN ('queued', 'running') LIMIT 1;`,
    );
    if (active[0]) {
      throw new ConflictException(
        `Run #${active[0].id} is still ${'in progress'}; one backfill runs at a time.`,
      );
    }

    const { rows } = await this.db.query<Row>(
      `INSERT INTO backfill_runs (from_date, to_date) VALUES ($1, $2) RETURNING *;`,
      [from, to],
    );
    const run = toRun(rows[0]!);

    await this.queue.add(
      'satellite-backfill',
      { runId: run.id, from, to },
      { jobId: `satellite-backfill-${run.id}` },
    );
    this.logger.log(`Satellite backfill #${run.id} queued: ${from} → ${to}`);
    return run;
  }

  private async ensureSchema(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS backfill_runs (
        id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        status           TEXT NOT NULL DEFAULT 'queued',
        from_date        DATE NOT NULL,
        to_date          DATE NOT NULL,
        sources          TEXT,
        requests_total   INTEGER,
        requests_done    INTEGER NOT NULL DEFAULT 0,
        detections_found INTEGER NOT NULL DEFAULT 0,
        reports_queued   INTEGER NOT NULL DEFAULT 0,
        coverage_gaps    JSONB NOT NULL DEFAULT '[]'::jsonb,
        error            TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        started_at       TIMESTAMPTZ,
        finished_at      TIMESTAMPTZ
      );
    `);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }
}

interface Row {
  id: string;
  status: BackfillStatus;
  from_date: Date | string;
  to_date: Date | string;
  sources: string | null;
  requests_total: number | null;
  requests_done: number;
  detections_found: number;
  reports_queued: number;
  coverage_gaps: Array<{ from: string; to: string }>;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

/** DATE columns come back as local-midnight Dates; keep them as plain days. */
function day(value: Date | string): string {
  return value instanceof Date
    ? new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
    : value;
}

function toRun(row: Row): BackfillRun {
  return {
    id: Number(row.id),
    status: row.status,
    from: day(row.from_date),
    to: day(row.to_date),
    sources: row.sources,
    requestsTotal: row.requests_total,
    requestsDone: row.requests_done,
    detectionsFound: row.detections_found,
    reportsQueued: row.reports_queued,
    coverageGaps: row.coverage_gaps ?? [],
    error: row.error,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
  };
}
