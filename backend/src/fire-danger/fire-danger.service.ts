/**
 * FireDangerService — the Canadian Fire Weather Index per zone, as the workers
 * computed it.
 *
 * The API does not compute the index; it serves it. The method lives with the
 * ingestion (workers/src/fire-danger/fwi.ts), where the weather it needs is
 * fetched, and where it is pinned to the published reference example by test.
 * What arrives here is a snapshot in Redis that expires on its own — so a
 * stopped worker leaves an honest "unavailable", never last week's danger
 * level looking current — and a history table this service owns the schema of.
 *
 * It is also where the wording is anchored: the index is COMPUTED by the
 * method EFFIS and the national maps use, on this deployment's weather data.
 * It is not the published EFFIS figure, and nothing downstream may call it
 * official. `method` travels with every response for that reason.
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
import { DatabaseService } from '../database/database.service';
import { createRedis, quitAll } from '../redis/redis.factory';

const FIRE_DANGER_KEY = 'fire-danger:current';

/** The six EFFIS classes, lowest first. Mirrors the workers' definition. */
export type DangerClass =
  | 'very_low'
  | 'low'
  | 'moderate'
  | 'high'
  | 'very_high'
  | 'extreme';

export interface FireDangerDay {
  date: string;
  fwi: number;
  dangerClass: DangerClass;
  ffmc: number;
  dmc: number;
  dc: number;
  isi: number;
  bui: number;
}

export interface ZoneFireDanger {
  zoneId: number;
  name: { de: string; en: string };
  hazardType: string;
  today: string;
  /** Yesterday, today, then the forecast days. */
  days: FireDangerDay[];
}

export interface FireDangerSnapshot {
  available: boolean;
  generatedAt: string | null;
  method: 'canadian_fwi' | null;
  zones: ZoneFireDanger[];
}

/** What the conditions endpoint folds in: one figure per zone, for today. */
export interface FireDangerToday {
  fwi: number;
  dangerClass: DangerClass;
}

@Injectable()
export class FireDangerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FireDangerService.name);
  private redis!: IORedis;

  constructor(
    private readonly db: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
    this.redis = createRedis(this.config, 'request');
  }

  /** The full snapshot: every zone, yesterday through the forecast. */
  async current(): Promise<FireDangerSnapshot> {
    let raw: string | null = null;
    try {
      raw = await this.redis.get(FIRE_DANGER_KEY);
    } catch (error) {
      this.logger.warn(`Could not read fire danger: ${(error as Error).message}`);
    }
    if (!raw) return { available: false, generatedAt: null, method: null, zones: [] };

    const snapshot = JSON.parse(raw) as Omit<FireDangerSnapshot, 'available'>;
    return { available: true, ...snapshot };
  }

  /** Today's figure per zone id — what the readiness list shows beside each zone. */
  async todayByZone(): Promise<Map<number, FireDangerToday>> {
    const snapshot = await this.current();
    const out = new Map<number, FireDangerToday>();
    for (const zone of snapshot.zones) {
      const today = zone.days.find((d) => d.date === zone.today);
      if (today) out.set(zone.zoneId, { fwi: today.fwi, dangerClass: today.dangerClass });
    }
    return out;
  }

  /**
   * The daily record. Written by the workers on every refresh; the schema
   * is here because the API owns every table, and reads it for the seasonal
   * picture and the incident register.
   */
  private async ensureSchema(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS fire_danger_history (
        zone_id      BIGINT NOT NULL REFERENCES high_risk_zones(id),
        day          DATE   NOT NULL,
        fwi          DOUBLE PRECISION NOT NULL,
        danger_class TEXT   NOT NULL,
        ffmc         DOUBLE PRECISION NOT NULL,
        dmc          DOUBLE PRECISION NOT NULL,
        dc           DOUBLE PRECISION NOT NULL,
        isi          DOUBLE PRECISION NOT NULL,
        bui          DOUBLE PRECISION NOT NULL,
        computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (zone_id, day)
      );
    `);
  }

  async onModuleDestroy(): Promise<void> {
    await quitAll(this.redis);
  }
}
