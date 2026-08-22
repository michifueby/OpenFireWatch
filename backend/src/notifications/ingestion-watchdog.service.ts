/**
 * IngestionWatchdog — notices when the system stops watching.
 *
 * A warning system that dies quietly is worse than none at all, because
 * people go on relying on it. If the workers stop, the FIRMS key expires, or
 * NASA changes a format, the map keeps showing the last known picture and
 * nothing about it looks wrong.
 *
 * The signal is already there and needs no new bookkeeping: every successful
 * ingestion cycle writes the conditions snapshot to Redis with a TTL of four
 * polling intervals. If that key is gone, no cycle has completed in a long
 * time. The watchdog watches for its absence.
 *
 * It reports recovery too. An operator who was told something broke is owed
 * the message that it works again — otherwise the only way to find out is to
 * go and look, which is the habit this is meant to replace.
 */

import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import IORedis from 'ioredis';

import { APP_CONFIG, AppConfig } from '../config/environment';
import { createRedis, quitAll } from '../redis/redis.factory';

import { recoveredText, stalledText } from './notification-texts';
import { NotificationService } from './notification.service';

/** Must match the workers' `BUS.CONDITIONS_KEY`. */
const CONDITIONS_KEY = 'conditions:current';

/** How often to look. Frequent enough to matter, rare enough to be free. */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class IngestionWatchdog implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionWatchdog.name);
  private redis?: IORedis;
  private timer?: ReturnType<typeof setInterval>;

  /**
   * Whether the last check found ingestion stalled. Only transitions are
   * announced — steady states are not news, and a message every five minutes
   * would train people to ignore the channel.
   */
  private stalled = false;

  /**
   * Startup is not evidence of a stall: the stack may still be coming up, and
   * the first ingestion cycle has not run yet. The watchdog stays quiet until
   * it has seen ingestion working at least once.
   */
  private everSeenHealthy = false;

  constructor(
    private readonly notifications: NotificationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    // 'stream': the dead-man's switch must ride out a broker restart —
    // giving up on the key it watches would report a false outage.
    this.redis = createRedis(this.config, 'stream');
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    // Do not unref: this timer is the point of the service.
    void this.check();
  }

  private async check(): Promise<void> {
    if (!this.redis) return;
    try {
      const alive = (await this.redis.exists(CONDITIONS_KEY)) === 1;

      if (alive) {
        if (this.stalled) {
          this.stalled = false;
          await this.notifications.notify({
            kind: 'ingestion.recovered',
            severity: 'warning',
            // Timestamped, so a later recovery is a new message rather than a
            // duplicate of the previous one.
            dedupeKey: `ingestion:recovered:${Date.now()}`,
            ...recoveredText(),
            data: {},
            url: this.config.api.publicUrl,
            occurredAt: new Date().toISOString(),
          });
        }
        this.everSeenHealthy = true;
        return;
      }

      if (!this.everSeenHealthy || this.stalled) return;

      this.stalled = true;
      this.logger.error('No recent ingestion cycle — notifying.');
      await this.notifications.notify({
        kind: 'ingestion.stalled',
        severity: 'critical',
        dedupeKey: `ingestion:stalled:${Date.now()}`,
        ...stalledText(),
        data: { conditionsKey: CONDITIONS_KEY },
        url: this.config.api.publicUrl,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      // A Redis blip is not a stall; saying so would be a false alarm about a
      // false alarm.
      this.logger.warn(`Watchdog check failed: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await quitAll(this.redis);
  }
}
