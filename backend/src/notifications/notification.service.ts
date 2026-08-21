/**
 * NotificationService — decides what is worth sending, and gets it sent.
 *
 * Everything channel-specific lives in the channels; everything about *when*
 * and *whether* lives here:
 *
 *   - Deduplication, so the same news is not relayed twice. Held in Redis
 *     rather than in memory, because two API replicas would otherwise each
 *     send their own copy of every alert.
 *   - A severity floor, so a deployment can ask for critical alerts only.
 *   - Fan-out that isolates failures: one channel being down must not stop
 *     the others, and must not stop the alert reaching the map.
 *   - A retry with backoff, because the usual failure is a momentary one.
 *   - A delivery record, so "did anyone get told?" has an answer that does
 *     not depend on reading the logs at the right moment.
 */

import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import IORedis from 'ioredis';

import { DatabaseService } from '../database/database.service';
import {
  NOTIFICATION_CHANNELS,
  NotificationChannel,
} from './notification-channel';
import {
  Notification,
  NotificationSeverity,
  SEVERITY_ORDER,
} from './notification.model';

/** Must match the workers' `BUS.ALERTS_CHANNEL`. */
const ALERTS_CHANNEL = 'alerts:anomalies';

/**
 * How long the same news stays suppressed.
 *
 * Long enough that a stall lasting hours does not send hourly reminders,
 * short enough that a genuinely new day's alert about the same zone still
 * gets through.
 */
const DEDUPE_TTL_SECONDS = 6 * 60 * 60;

/** Two quick retries: the usual failure is a blip, not a misconfiguration. */
const RETRY_DELAYS_MS = [1_000, 5_000];

@Injectable()
export class NotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationService.name);
  private subscriber?: IORedis;
  private redis?: IORedis;

  constructor(
    private readonly db: DatabaseService,
    @Inject(NOTIFICATION_CHANNELS)
    private readonly channels: NotificationChannel[],
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();

    const options = {
      host: process.env.REDIS_HOST ?? 'redis',
      port: Number(process.env.REDIS_PORT ?? 6379),
      db: Number(process.env.REDIS_DB ?? 0),
      retryStrategy: (attempt: number) => Math.min(2 ** attempt * 100, 30_000),
    };
    this.redis = new IORedis(options);
    this.subscriber = new IORedis(options);

    await this.subscriber.subscribe(ALERTS_CHANNEL);
    this.subscriber.on('message', (_channel, payload) => {
      void this.onAlert(payload);
    });

    const active = this.configuredChannels().map((c) => c.name);
    this.logger.log(
      active.length
        ? `Notifications active on: ${active.join(', ')}`
        : 'No notification channel configured — alerts reach the map only.',
    );
  }

  /** Channels this deployment actually set up. */
  configuredChannels(): NotificationChannel[] {
    return this.channels.filter((channel) => channel.isConfigured());
  }

  /** Every channel with its configured state — for the status endpoint. */
  describeChannels(): { name: string; configured: boolean }[] {
    return this.channels.map((channel) => ({
      name: channel.name,
      configured: channel.isConfigured(),
    }));
  }

  /**
   * Send a notification through every configured channel.
   *
   * Never throws: a notification is a side effect of something more
   * important, and no failure here may propagate into the path that puts an
   * alert on the map.
   */
  async notify(notification: Notification): Promise<void> {
    try {
      if (!this.meetsSeverityFloor(notification.severity)) return;

      const channels = this.configuredChannels();
      if (channels.length === 0) return;

      if (!(await this.claim(notification.dedupeKey))) {
        this.logger.debug(`Suppressed duplicate: ${notification.dedupeKey}`);
        return;
      }

      // allSettled, not all: one channel's failure must not cancel the others.
      await Promise.allSettled(
        channels.map((channel) => this.deliver(channel, notification)),
      );
    } catch (error) {
      this.logger.error(
        `Notification dispatch failed: ${(error as Error).message}`,
      );
    }
  }

  /** One channel, with retries, recorded either way. */
  private async deliver(
    channel: NotificationChannel,
    notification: Notification,
  ): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        await channel.send(notification);
        await this.record(notification, channel.name, 'sent', null);
        return;
      } catch (error) {
        lastError = error as Error;
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    this.logger.error(
      `Channel ${channel.name} failed for ${notification.dedupeKey}: ${lastError?.message}`,
    );
    await this.record(notification, channel.name, 'failed', lastError?.message ?? null);
  }

  /**
   * Claim the right to send this news, once, across all replicas.
   *
   * SET NX is atomic, so of two replicas receiving the same alert exactly one
   * wins. Failing open on a Redis error is deliberate: a duplicate warning is
   * a nuisance, a missing one is the thing this system exists to prevent.
   */
  private async claim(dedupeKey: string): Promise<boolean> {
    if (!this.redis) return true;
    try {
      const result = await this.redis.set(
        `notify:sent:${dedupeKey}`,
        '1',
        'EX',
        DEDUPE_TTL_SECONDS,
        'NX',
      );
      return result === 'OK';
    } catch {
      return true;
    }
  }

  private meetsSeverityFloor(severity: NotificationSeverity): boolean {
    const floor = (process.env.NOTIFY_MIN_SEVERITY ?? 'warning').trim() as
      | NotificationSeverity
      | string;
    const minimum = SEVERITY_ORDER[floor as NotificationSeverity];
    // An unrecognised value must not silently mute everything.
    if (minimum === undefined) return true;
    return SEVERITY_ORDER[severity] >= minimum;
  }

  /** Relay a critical evaluation. Anything below critical stays on the map. */
  private async onAlert(payload: string): Promise<void> {
    try {
      const alert = JSON.parse(payload) as {
        id: number;
        level?: string;
        latitude: number;
        longitude: number;
        acquiredAt: string;
        zone?: { name?: { de?: string; en?: string } } | null;
        weather?: { temperatureC?: number; soilMoisturePct?: number };
      };
      if (!alert.level?.startsWith('CRITICAL_')) return;

      const zone = alert.zone?.name?.de ?? alert.zone?.name?.en ?? 'außerhalb aller Zonen';
      const temperature = alert.weather?.temperatureC;
      const soil = alert.weather?.soilMoisturePct;

      await this.notify({
        kind: 'alert.critical',
        severity: 'critical',
        // Per anomaly: the same detection re-evaluated is the same news.
        dedupeKey: `alert:${alert.id}`,
        title: `${humanLevel(alert.level)} — ${zone}`,
        body: [
          `Zone: ${zone}`,
          temperature !== undefined ? `Temperatur: ${temperature} °C` : null,
          soil !== undefined ? `Bodenfeuchte: ${soil} %` : null,
          `Koordinaten: ${alert.latitude.toFixed(4)}, ${alert.longitude.toFixed(4)}`,
          `Satellitenaufnahme: ${new Date(alert.acquiredAt).toLocaleString('de-AT')}`,
          '',
          'Kein Ersatz für den Notruf 122.',
        ]
          .filter(Boolean)
          .join('\n'),
        data: { ...alert },
        url: process.env.PUBLIC_URL?.trim() || 'https://openfirewatch.org',
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(`Malformed alert payload: ${(error as Error).message}`);
    }
  }

  private async record(
    notification: Notification,
    channel: string,
    status: 'sent' | 'failed',
    error: string | null,
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO notification_deliveries (kind, dedupe_key, channel, status, error)
         VALUES ($1, $2, $3, $4, $5);`,
        [notification.kind, notification.dedupeKey, channel, status, error],
      );
    } catch (dbError) {
      // The record is for the post-mortem; failing to write it must not stop
      // the notification that is already on its way.
      this.logger.warn(
        `Could not record delivery: ${(dbError as Error).message}`,
      );
    }
  }

  private async ensureSchema(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        kind       TEXT NOT NULL,
        dedupe_key TEXT NOT NULL,
        channel    TEXT NOT NULL,
        status     TEXT NOT NULL,
        error      TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_deliveries_time
        ON notification_deliveries (created_at DESC);
    `);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.subscriber?.quit(), this.redis?.quit()]);
  }
}

/** Level constants read as SHOUTING; notifications are read by people. */
function humanLevel(level: string): string {
  const names: Record<string, string> = {
    CRITICAL_PHOSPHORUS_FIRE: 'Phosphorbrand',
    CRITICAL_WILDFIRE: 'Waldbrand',
    CRITICAL_ORDNANCE_HEAT: 'Hitze an Munitionsstandort',
    CRITICAL_SMOULDERING: 'Glutnest',
    CRITICAL_THERMAL_ANOMALY: 'Thermische Anomalie',
  };
  return names[level] ?? level;
}
