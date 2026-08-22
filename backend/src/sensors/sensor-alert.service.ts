/**
 * SensorAlertService — the sensor as a witness, not just a thermometer.
 *
 * Until now a ground sensor could only refine the evaluation of something a
 * SATELLITE had seen. But the manual's first documented limit is exactly the
 * blind spot a buried probe covers: smouldering under the surface, in root
 * systems, under a closed canopy — too cool, too small and too covered for a
 * 375 m pixel, and hours stale even when visible. A probe reading 55 °C in
 * the soil knows about the fire before any pixel does.
 *
 * Two independent triggers, both on CALIBRATED values:
 *
 *   absolute  T ≥ SENSOR_ALERT_TEMPERATURE_C   (default 50 °C — no soil at
 *             this latitude reaches that under canopy by weather alone)
 *   rise      T ≥ 35 °C AND T − median(6 h before) ≥ SENSOR_ALERT_RISE_C
 *             (default 15 K — a smoulder announces itself as a climb long
 *             before it crosses any absolute line; the 35 °C floor keeps a
 *             cold morning warming into a hot noon from qualifying)
 *
 * A triggered alert is NOT a special path. It becomes an ordinary anomaly and
 * an ordinary validated event, published on the ordinary channel — so the
 * map, the panel, acknowledgement, escalation, notifications, the incident
 * register and the history treat it exactly like every other critical alert.
 * The one deliberate difference: no weather gate. The gates answer "could
 * something ignite?", and a measured 55 °C is past the question — the same
 * principle by which smouldering persistence outranks prediction.
 */

import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';

import { APP_CONFIG, AppConfig } from '../config/environment';
import { createRedis, quitAll } from '../redis/redis.factory';

import { DatabaseService } from '../database/database.service';
import { AlertLevel } from '../evaluation/alert-level.enum';

/** Must match the workers' `BUS.ALERTS_CHANNEL`. */
const ALERTS_CHANNEL = 'alerts:anomalies';

/** Prefix marking anomalies that originate from a probe, not a satellite. */
const SENSOR_SOURCE_PREFIX = 'GROUND_SENSOR:';

@Injectable()
export class SensorAlertService implements OnModuleDestroy {
  private readonly logger = new Logger(SensorAlertService.name);
  private publisher?: IORedis;

  constructor(
    private readonly db: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Lazy: most deployments see readings long before the first alert. */
  private getPublisher(): IORedis {
    // 'stream': publishing an alert must not be abandoned because the
    // broker happened to be restarting.
    this.publisher ??= createRedis(this.config, 'stream');
    return this.publisher;
  }

  private absoluteThreshold(): number {
    return this.config.sensors.alertTemperatureC;
  }

  private riseThreshold(): number {
    return this.config.sensors.alertRiseC;
  }

  /** One alert per probe per episode; a smoulder needs no hourly repeats. */
  private cooldownHours(): number {
    return this.config.sensors.alertCooldownHours;
  }

  /**
   * Called after every stored reading. Never throws: an alerting failure must
   * not reject the reading that carried the evidence.
   */
  async evaluate(sensorId: number, observedAt: string): Promise<void> {
    try {
      const absolute = this.absoluteThreshold();
      const rise = this.riseThreshold();
      if (absolute <= 0 && rise <= 0) return;

      const reading = await this.calibratedReading(sensorId, observedAt);
      if (!reading || reading.temperatureC === null) return;

      const temperature = reading.temperatureC;
      let trigger: 'absolute' | 'rise' | null = null;

      if (absolute > 0 && temperature >= absolute) {
        trigger = 'absolute';
      } else if (rise > 0 && temperature >= 35) {
        const baseline = await this.baselineMedian(sensorId, observedAt);
        // No baseline, no rise verdict: a first-ever reading of 38 °C on a
        // hot day must not alarm just because there is nothing to compare.
        if (baseline !== null && temperature - baseline >= rise) {
          trigger = 'rise';
        }
      }
      if (!trigger) return;

      if (await this.inCooldown(reading.deviceId)) return;
      await this.raise(reading, temperature, trigger);
    } catch (error) {
      this.logger.error(
        `Sensor alert evaluation failed: ${(error as Error).message}`,
      );
    }
  }

  /** The just-stored reading, calibrated, with everything an alert needs. */
  private async calibratedReading(sensorId: number, observedAt: string) {
    const { rows } = await this.db.query<{
      device_id: string;
      label: string;
      latitude: number;
      longitude: number;
      zone_id: string | null;
      name: string | null;
      name_de: string | null;
      name_en: string | null;
      hazard_type: string | null;
      temperature_c: number | null;
      soil_moisture_pct: number | null;
    }>(
      `
      SELECT s.device_id, s.label,
             ST_Y(s.geom) AS latitude, ST_X(s.geom) AS longitude,
             z.id AS zone_id, z.name, z.name_de, z.name_en, z.hazard_type,
             CASE WHEN r.temperature_c_raw IS NULL THEN NULL
                  ELSE r.temperature_c_raw + s.temperature_offset_c END AS temperature_c,
             CASE WHEN r.soil_moisture_pct_raw IS NULL THEN NULL
                  ELSE LEAST(100, GREATEST(0,
                         r.soil_moisture_pct_raw * s.soil_moisture_scale
                           + s.soil_moisture_offset_pct)) END          AS soil_moisture_pct
        FROM ground_sensors s
        JOIN sensor_readings r ON r.sensor_id = s.id AND r.observed_at = $2
        LEFT JOIN high_risk_zones z ON z.is_active AND ST_Intersects(z.geom, s.geom)
       WHERE s.id = $1;
      `,
      [sensorId, observedAt],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      deviceId: row.device_id,
      label: row.label,
      latitude: row.latitude,
      longitude: row.longitude,
      zone: row.zone_id
        ? {
            id: Number(row.zone_id),
            name: {
              en: row.name_en ?? row.name ?? '',
              de: row.name_de ?? row.name ?? '',
            },
            hazardType: row.hazard_type ?? 'generic',
          }
        : null,
      temperatureC:
        row.temperature_c === null ? null : Number(row.temperature_c),
      soilMoisturePct:
        row.soil_moisture_pct === null ? null : Number(row.soil_moisture_pct),
      observedAt,
    };
  }

  /**
   * Median calibrated temperature of the six hours BEFORE this reading.
   * The median, not the mean: one earlier spike must not lift the baseline
   * and hide the climb that follows it.
   */
  private async baselineMedian(
    sensorId: number,
    observedAt: string,
  ): Promise<number | null> {
    const { rows } = await this.db.query<{ median: number | null; n: string }>(
      `
      SELECT percentile_cont(0.5) WITHIN GROUP (
               ORDER BY r.temperature_c_raw + s.temperature_offset_c
             ) AS median,
             count(*) AS n
        FROM sensor_readings r
        JOIN ground_sensors s ON s.id = r.sensor_id
       WHERE r.sensor_id = $1
         AND r.temperature_c_raw IS NOT NULL
         AND r.observed_at <  $2
         AND r.observed_at >= $2::timestamptz - interval '6 hours';
      `,
      [sensorId, observedAt],
    );
    const row = rows[0];
    // One prior point is a coincidence, not a baseline.
    if (!row || row.median === null || Number(row.n) < 2) return null;
    return Number(row.median);
  }

  /** An unexpired alert for this probe means the episode is already known. */
  private async inCooldown(deviceId: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `
      SELECT 1
        FROM validated_events ve
        JOIN thermal_anomalies a ON a.id = ve.anomaly_id
       WHERE a.source = $1
         AND ve.alert_level = $2
         AND ve.evaluated_at >= now() - ($3 || ' hours')::interval
       LIMIT 1;
      `,
      [
        SENSOR_SOURCE_PREFIX + deviceId,
        AlertLevel.CRITICAL_SENSOR_HEAT,
        this.cooldownHours(),
      ],
    );
    return rows.length > 0;
  }

  /** Insert the ordinary records and publish the ordinary payload. */
  private async raise(
    reading: NonNullable<Awaited<ReturnType<SensorAlertService['calibratedReading']>>>,
    temperature: number,
    trigger: 'absolute' | 'rise',
  ): Promise<void> {
    // Soil for the record: the probe's own value where it has one, otherwise
    // 0 with the honesty living in the payload (the sensor block names the
    // probe, and a probe without a moisture channel measures none).
    const soil = reading.soilMoisturePct ?? 0;

    const { rows } = await this.db.query<{ id: string }>(
      `
      INSERT INTO thermal_anomalies
        (source, satellite, geom, acquired_at, brightness_k, frp_mw, confidence, weather)
      VALUES ($1, NULL, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, NULL, NULL, 'h', $5)
      ON CONFLICT (source, geom, acquired_at) DO NOTHING
      RETURNING id;
      `,
      [
        SENSOR_SOURCE_PREFIX + reading.deviceId,
        reading.longitude,
        reading.latitude,
        reading.observedAt,
        JSON.stringify({ temperatureC: temperature, soilMoisturePct: soil, origin: 'ground-sensor' }),
      ],
    );
    // Conflict → this exact reading already raised; nothing more to do.
    const anomalyId = rows[0] ? Number(rows[0].id) : null;
    if (anomalyId === null) return;

    await this.db.query(
      `
      INSERT INTO validated_events
        (anomaly_id, zone_id, alert_level, temperature_c, soil_moisture_pct)
      VALUES ($1, $2, $3, $4, $5);
      `,
      [
        anomalyId,
        reading.zone?.id ?? null,
        AlertLevel.CRITICAL_SENSOR_HEAT,
        temperature,
        soil,
      ],
    );

    await this.getPublisher().publish(
      ALERTS_CHANNEL,
      JSON.stringify({
        type: 'thermal_anomaly',
        id: anomalyId,
        latitude: reading.latitude,
        longitude: reading.longitude,
        acquiredAt: reading.observedAt,
        level: AlertLevel.CRITICAL_SENSOR_HEAT,
        zone: reading.zone,
        weather: { temperatureC: temperature, soilMoisturePct: soil },
        sensor: { deviceId: reading.deviceId, label: reading.label },
      }),
    );

    this.logger.error(
      `🌡 CRITICAL_SENSOR_HEAT — probe "${reading.label}" (${reading.deviceId}) ` +
        `measured ${temperature}°C [${trigger}] at (${reading.latitude}, ${reading.longitude})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await quitAll(this.publisher);
  }
}
