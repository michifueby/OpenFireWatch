/**
 * StatusService — what the system is actually doing, in one place.
 *
 * WHY THIS EXISTS. The ingestion watchdog answers "did a cycle run?" and the
 * health endpoint answers "is the process up?". Neither can answer "what did
 * we ask, and did anyone reply" — and on 14 August 2026 this deployment was
 * healthy by both measures while watching one satellite out of three. Four
 * overpasses saw a fire over the Föhrenwald that day; the system fetched one
 * of them, 79 minutes late, and every log line said "no hotspots in the
 * monitored area". Which was true, and useless.
 *
 * So the page is built around one distinction: quiet is not the same as not
 * looking. Every feed reports when it last delivered and whether that is
 * recent enough for its own rhythm — never a bare "ok".
 *
 * Read-only and public, like every other read here: it exposes what the
 * system is doing, not how to change it.
 */

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { APP_CONFIG, AppConfig } from '../config/environment';
import { DatabaseService } from '../database/database.service';
import { createRedis, quitAll, redisOptions } from '../redis/redis.factory';
import { FeedState, Overall, classify, overallState } from './system-status';

/** Keys the workers publish. Mirrors workers/src/config.ts BUS. */
const CONDITIONS_KEY = 'conditions:current';
const FORECAST_KEY = 'forecast:current';
const FIRE_DANGER_KEY = 'fire-danger:current';
const INGEST_SOURCES_KEY = 'ingest:sources';
const DEAD_LETTER_QUEUE = 'dlq.ingestion';

/**
 * How long each feed may go without delivering before a reader should be
 * told. Generous multiples of each rhythm rather than tight bounds: the point
 * is to catch a feed that has STOPPED, not to complain about one late cycle.
 */
const STALE_AFTER = {
  /** Ingestion runs every 5 minutes by default. */
  cycle: 20 * 60,
  weather: 20 * 60,
  /** Forecast and fire danger refresh hourly. */
  forecast: 3 * 60 * 60,
  fireDanger: 3 * 60 * 60,
} as const;

export interface SourceStatus {
  source: string;
  ok: boolean;
  at: string | null;
  detections: number;
  error: string | null;
}

export interface SystemStatus {
  generatedAt: string;
  overall: Overall;
  ingestion: {
    cycle: FeedState;
    /** How many days back each cycle asks for. */
    lookbackDays: number | null;
    sources: SourceStatus[];
  };
  weather: FeedState & { stationId: string | null; temperatureC: number | null; soilMoisturePct: number | null };
  forecast: FeedState & { zones: number };
  fireDanger: FeedState & { zones: number };
  detections: {
    last24h: number;
    last7d: number;
    total: number;
    newestAcquiredAt: string | null;
    /** How far back the record reaches, live and replayed together. */
    oldestAcquiredAt: string | null;
  };
  sensors: { registered: number; reporting: number; silent: number };
  queue: { deadLetters: number };
  archive: { runs: number; replayedTo: string | null; lastRunStatus: string | null };
}

@Injectable()
export class StatusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StatusService.name);
  private redis!: IORedis;
  private deadLetters!: Queue;

  constructor(
    private readonly db: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.redis = createRedis(this.config, 'request');
    this.deadLetters = new Queue(DEAD_LETTER_QUEUE, {
      connection: redisOptions(this.config, 'request'),
    });
  }

  async current(): Promise<SystemStatus> {
    const now = Date.now();

    const [conditions, forecast, fireDanger, sources, counts, sensors, dlq, archive] =
      await Promise.all([
        this.readJson<{ cycleAt?: string; observedAt?: string; stationId?: string; temperatureC?: number; soilMoisturePct?: number }>(CONDITIONS_KEY),
        this.readJson<{ generatedAt?: string; zones?: unknown[] }>(FORECAST_KEY),
        this.readJson<{ generatedAt?: string; zones?: unknown[] }>(FIRE_DANGER_KEY),
        this.readJson<{ lookbackDays?: number; sources?: SourceOutcome[] }>(INGEST_SOURCES_KEY),
        this.detectionCounts(),
        this.sensorCounts(),
        this.deadLetterCount(),
        this.archiveState(),
      ]);

    const cycle = classify(conditions?.cycleAt, STALE_AFTER.cycle, now);
    const weather = classify(conditions?.observedAt, STALE_AFTER.weather, now);
    const forecastState = classify(forecast?.generatedAt, STALE_AFTER.forecast, now);
    const dangerState = classify(fireDanger?.generatedAt, STALE_AFTER.fireDanger, now);

    const sourceStatuses: SourceStatus[] = (sources?.sources ?? []).map((s) => ({
      source: s.source,
      ok: s.ok,
      at: s.at ?? null,
      detections: s.detections ?? 0,
      error: s.error ?? null,
    }));

    return {
      generatedAt: new Date(now).toISOString(),
      overall: overallState({
        cycle: cycle.freshness,
        sources: sourceStatuses,
        weather: weather.freshness,
        forecast: forecastState.freshness,
        fireDanger: dangerState.freshness,
        deadLetters: dlq,
      }),
      ingestion: {
        cycle,
        lookbackDays: sources?.lookbackDays ?? null,
        sources: sourceStatuses,
      },
      weather: {
        ...weather,
        stationId: conditions?.stationId ?? null,
        temperatureC: conditions?.temperatureC ?? null,
        soilMoisturePct: conditions?.soilMoisturePct ?? null,
      },
      forecast: { ...forecastState, zones: forecast?.zones?.length ?? 0 },
      fireDanger: { ...dangerState, zones: fireDanger?.zones?.length ?? 0 },
      detections: counts,
      sensors,
      queue: { deadLetters: dlq },
      archive,
    };
  }

  private async readJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      this.logger.warn(`Could not read ${key}: ${(error as Error).message}`);
      return null;
    }
  }

  /** Counted by ACQUISITION time: when the sky was seen, not when we judged it. */
  private async detectionCounts(): Promise<SystemStatus['detections']> {
    const { rows } = await this.db.query<{
      last_24h: string;
      last_7d: string;
      total: string;
      newest: Date | null;
      oldest: Date | null;
    }>(
      `SELECT count(*) FILTER (WHERE acquired_at >= now() - interval '24 hours') AS last_24h,
              count(*) FILTER (WHERE acquired_at >= now() - interval '7 days')   AS last_7d,
              count(*)                                                           AS total,
              max(acquired_at) AS newest,
              min(acquired_at) AS oldest
         FROM thermal_anomalies;`,
    );
    const row = rows[0];
    return {
      last24h: Number(row?.last_24h ?? 0),
      last7d: Number(row?.last_7d ?? 0),
      total: Number(row?.total ?? 0),
      newestAcquiredAt: row?.newest?.toISOString() ?? null,
      oldestAcquiredAt: row?.oldest?.toISOString() ?? null,
    };
  }

  private async sensorCounts(): Promise<SystemStatus['sensors']> {
    const { rows } = await this.db.query<{ registered: string; reporting: string }>(
      `SELECT count(*) AS registered,
              count(*) FILTER (
                WHERE last_seen_at >= now() - ($1 || ' minutes')::interval
              ) AS reporting
         FROM ground_sensors
        WHERE is_active;`,
      [this.config.sensors.maxAgeMinutes],
    );
    const registered = Number(rows[0]?.registered ?? 0);
    const reporting = Number(rows[0]?.reporting ?? 0);
    return { registered, reporting, silent: registered - reporting };
  }

  private async deadLetterCount(): Promise<number> {
    try {
      const counts = await this.deadLetters.getJobCounts('waiting', 'completed', 'failed');
      return (counts['waiting'] ?? 0) + (counts['completed'] ?? 0) + (counts['failed'] ?? 0);
    } catch (error) {
      this.logger.warn(`Could not read the dead letter queue: ${(error as Error).message}`);
      return 0;
    }
  }

  private async archiveState(): Promise<SystemStatus['archive']> {
    try {
      const { rows } = await this.db.query<{
        runs: string;
        replayed_to: Date | string | null;
        last_status: string | null;
      }>(
        `SELECT count(*) AS runs,
                max(to_date) FILTER (WHERE status = 'done') AS replayed_to,
                (SELECT status FROM backfill_runs ORDER BY created_at DESC LIMIT 1) AS last_status
           FROM backfill_runs;`,
      );
      const row = rows[0];
      const replayed = row?.replayed_to ?? null;
      return {
        runs: Number(row?.runs ?? 0),
        replayedTo:
          replayed instanceof Date
            ? new Date(replayed.getTime() - replayed.getTimezoneOffset() * 60_000)
                .toISOString()
                .slice(0, 10)
            : replayed,
        lastRunStatus: row?.last_status ?? null,
      };
    } catch {
      // The table is created by BackfillService on boot; a status read must
      // not fail because that has not happened yet.
      return { runs: 0, replayedTo: null, lastRunStatus: null };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.deadLetters?.close()]);
    await quitAll(this.redis);
  }
}

/** Shape the workers publish per satellite product. */
interface SourceOutcome {
  source: string;
  at?: string;
  ok: boolean;
  detections?: number;
  error?: string;
}
