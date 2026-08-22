/**
 * ConditionsService — what the ground looks like right now, per zone.
 *
 * The system used to answer only one question: "is something burning?" This
 * answers the one that comes before it — "how close is each zone to the point
 * where a detection would escalate?" A responder can see at ten in the morning
 * that today is a critical day, instead of finding out when the alarm fires.
 *
 * IMPORTANT — what the numbers are, and what they are not:
 * weather is measured ONCE PER CYCLE for the whole monitored area (one TAWES
 * station plus one soil-moisture sample at the area centroid). They are
 * therefore AREA conditions, not per-zone measurements, and the API says so.
 * What genuinely differs per zone is the THRESHOLD each hazard type applies —
 * and that is what the per-zone part reports.
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

import { DatabaseService } from '../database/database.service';
import { PHOSPHORUS_IGNITION, profileFor } from '../evaluation/alert-level.enum';
import {
  DangerClass,
  FireDangerService,
  FireDangerToday,
} from '../fire-danger/fire-danger.service';

/** Must match the workers' BUS.CONDITIONS_KEY. */
const CONDITIONS_KEY = 'conditions:current';

export interface ZoneReadiness {
  id: number;
  name: { en: string; de: string };
  hazardType: string;
  /** Which gate decides escalation for this zone. */
  gate: 'weather' | 'detection';
  /** True when a credible detection here would escalate right now. */
  armed: boolean;
  /**
   * Only for weather-gated zones: how far today's conditions still are from
   * the escalation window. Negative means the threshold is already passed.
   */
  temperatureGapC?: number;
  soilMoistureGapPct?: number;
  /** Today's Canadian FWI at this zone, when the workers have computed one. */
  fireDanger?: FireDangerToday;
}

/**
 * The fire danger line on the panel: the worst zone today.
 *
 * Shown as ONE line, not one per zone — the zones in a deployment sit a few
 * kilometres apart and read the same weather, and a reader wants the number
 * the way the national map gives it: one figure for the area.
 */
export interface FireDangerSummary {
  available: boolean;
  /** Always 'canadian_fwi' when available: computed, not the EFFIS figure. */
  method: 'canadian_fwi' | null;
  fwi?: number;
  dangerClass?: DangerClass;
  /** Which zone carries the worst figure. */
  zoneId?: number;
  /** Tomorrow at the same zone — the trend a reader wants next. */
  tomorrow?: { fwi: number; dangerClass: DangerClass };
  generatedAt?: string;
}

export interface CurrentConditions {
  available: boolean;
  observedAt?: string;
  cycleAt?: string;
  temperatureC?: number;
  windSpeedKmh?: number | null;
  windDirectionDeg?: number | null;
  relativeHumidityPct?: number;
  soilMoisturePct?: number;
  stationId?: string;
  area?: string;
  zones: ZoneReadiness[];
  fireDanger: FireDangerSummary;
}

@Injectable()
export class ConditionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConditionsService.name);
  private redis!: IORedis;

  constructor(
    private readonly db: DatabaseService,
    private readonly fireDanger: FireDangerService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    // 'request': this connection serves HTTP reads, so a hung broker must
    // fail the command rather than stall the response.
    this.redis = createRedis(this.config, 'request');
  }

  async current(): Promise<CurrentConditions> {
    const [snapshot, zones, danger] = await Promise.all([
      this.readSnapshot(),
      this.readZones(),
      this.fireDanger.current(),
    ]);

    const todayByZone = new Map<number, FireDangerToday>();
    const tomorrowByZone = new Map<number, FireDangerToday>();
    for (const zone of danger.zones) {
      const index = zone.days.findIndex((d) => d.date === zone.today);
      const today = index >= 0 ? zone.days[index] : undefined;
      const tomorrow = index >= 0 ? zone.days[index + 1] : undefined;
      if (today) todayByZone.set(zone.zoneId, { fwi: today.fwi, dangerClass: today.dangerClass });
      if (tomorrow) tomorrowByZone.set(zone.zoneId, { fwi: tomorrow.fwi, dangerClass: tomorrow.dangerClass });
    }
    const fireDanger = summariseDanger(danger.available, danger.generatedAt, todayByZone, tomorrowByZone);

    // No snapshot yet (fresh deployment, or ingestion stopped long enough for
    // the key to expire). Still report the zones, but with no readiness — a
    // guess would be worse than an honest gap.
    if (!snapshot) {
      return {
        available: false,
        zones: zones.map((z) => this.assess(z, undefined, todayByZone.get(z.id))),
        fireDanger,
      };
    }

    return {
      available: true,
      observedAt: snapshot.observedAt,
      cycleAt: snapshot.cycleAt,
      temperatureC: snapshot.temperatureC,
      windSpeedKmh: snapshot.windSpeedKmh ?? null,
      windDirectionDeg: snapshot.windDirectionDeg ?? null,
      relativeHumidityPct: snapshot.relativeHumidityPct,
      soilMoisturePct: snapshot.soilMoisturePct,
      stationId: snapshot.stationId,
      area: snapshot.area,
      zones: zones.map((z) => this.assess(z, snapshot, todayByZone.get(z.id))),
      fireDanger,
    };
  }

  /** Combine a zone's hazard profile with the measured conditions. */
  private assess(
    zone: { id: number; nameEn: string; nameDe: string; hazardType: string },
    snapshot: Snapshot | undefined,
    fireDanger: FireDangerToday | undefined,
  ): ZoneReadiness {
    const profile = profileFor(zone.hazardType);
    const base = {
      id: zone.id,
      name: { en: zone.nameEn, de: zone.nameDe },
      hazardType: zone.hazardType,
      ...(fireDanger ? { fireDanger } : {}),
    };

    if (!profile.requiresIgnitionWeather) {
      // Wildfire, ordnance and generic zones do not wait for weather: a
      // credible detection escalates whenever it arrives.
      return { ...base, gate: 'detection', armed: true };
    }

    if (!snapshot) {
      return { ...base, gate: 'weather', armed: false };
    }

    // Positive gap = still that far from the threshold; negative = passed it.
    const temperatureGapC = round1(
      PHOSPHORUS_IGNITION.IGNITION_TEMPERATURE_C - snapshot.temperatureC,
    );
    const soilMoistureGapPct = round1(
      snapshot.soilMoisturePct - PHOSPHORUS_IGNITION.CRITICAL_SOIL_MOISTURE_PCT,
    );

    return {
      ...base,
      gate: 'weather',
      armed: temperatureGapC <= 0 && soilMoistureGapPct < 0,
      temperatureGapC,
      soilMoistureGapPct,
    };
  }

  private async readSnapshot(): Promise<Snapshot | undefined> {
    try {
      const raw = await this.redis.get(CONDITIONS_KEY);
      return raw ? (JSON.parse(raw) as Snapshot) : undefined;
    } catch (error) {
      this.logger.warn(`Could not read conditions: ${(error as Error).message}`);
      return undefined;
    }
  }

  private async readZones(): Promise<
    Array<{ id: number; nameEn: string; nameDe: string; hazardType: string }>
  > {
    const { rows } = await this.db.query<{
      id: string;
      name: string;
      name_en: string | null;
      name_de: string | null;
      hazard_type: string;
    }>(
      `SELECT id, name, name_en, name_de, hazard_type
         FROM high_risk_zones WHERE is_active ORDER BY id;`,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      nameEn: r.name_en ?? r.name,
      nameDe: r.name_de ?? r.name,
      hazardType: r.hazard_type,
    }));
  }

  async onModuleDestroy(): Promise<void> {
    await quitAll(this.redis);
  }
}

interface Snapshot {
  observedAt: string;
  cycleAt: string;
  temperatureC: number;
  relativeHumidityPct: number;
  /** Nullable: not every station carries an anemometer. */
  windSpeedKmh?: number | null;
  windDirectionDeg?: number | null;
  soilMoisturePct: number;
  stationId: string;
  area: string;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The worst zone today is the area's figure; its tomorrow is the trend. */
function summariseDanger(
  available: boolean,
  generatedAt: string | null,
  today: Map<number, FireDangerToday>,
  tomorrow: Map<number, FireDangerToday>,
): FireDangerSummary {
  if (!available || today.size === 0) return { available: false, method: null };

  let worstId: number | undefined;
  let worst: FireDangerToday | undefined;
  for (const [zoneId, figure] of today) {
    if (!worst || figure.fwi > worst.fwi) {
      worst = figure;
      worstId = zoneId;
    }
  }
  const next = worstId !== undefined ? tomorrow.get(worstId) : undefined;

  return {
    available: true,
    method: 'canadian_fwi',
    fwi: worst!.fwi,
    dangerClass: worst!.dangerClass,
    zoneId: worstId,
    ...(next ? { tomorrow: next } : {}),
    ...(generatedAt ? { generatedAt } : {}),
  };
}
