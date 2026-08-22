/**
 * SensorService — the ground-truth half of the picture.
 *
 * Everything the escalation rules read today is regional: one TAWES station
 * and one soil-moisture grid point standing in for a monitored area roughly
 * 18 km across. The two numbers the phosphorus rule turns on — 30 °C and 20 %
 * topsoil moisture — describe conditions in the soil where the ordnance
 * actually lies, and a modelled value from kilometres away is a reasonable
 * guess at them, not a measurement.
 *
 * A sensor in the wood measures them. This service owns the registry of those
 * sensors, their readings, and the calibration that makes the readings mean
 * what they claim to.
 *
 * Two deliberate choices worth knowing:
 *
 *   - Readings are stored RAW and calibrated on read. Capacitive soil probes
 *     drift and are soil-dependent, so a calibration is a guess that gets
 *     better; baking it into the stored value would make every past reading
 *     permanently wrong the day the guess is corrected.
 *
 *   - A device id that is not registered is REFUSED, never created on the
 *     fly. Registering a sensor is where its position and calibration are
 *     recorded, and a reading with no position cannot be attributed to a
 *     zone — it would be a number with nowhere to apply.
 */

import {
  Inject,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';

import { APP_CONFIG, AppConfig } from '../config/environment';
import { DatabaseService } from '../database/database.service';
import { RegisterSensorDto } from './register-sensor.dto';
import { SensorAlertService } from './sensor-alert.service';
import { SensorReadingDto } from './sensor-reading.dto';

/**
 * How old a reading may be and still describe "now".
 *
 * A LoRaWAN sensor on battery typically reports every 15–60 minutes, so the
 * default tolerates a missed uplink or two without declaring the sensor gone.
 * Past it the reading is not used at all — a dead sensor must never be able
 * to report calm conditions on behalf of a wood that is drying out.
 */
// Configured via SENSOR_MAX_AGE_MINUTES — see config/environment.ts.

/** A registered sensor and its most recent state. */
export interface SensorStatus {
  id: number;
  deviceId: string;
  label: string;
  latitude: number;
  longitude: number;
  zoneId: number | null;
  lastSeenAt: string | null;
  /** False once the newest reading is older than the freshness window. */
  reporting: boolean;
  temperatureC: number | null;
  soilMoisturePct: number | null;
  batteryPct: number | null;
  /** Calibration in effect — the editor must round-trip it, not reset it. */
  temperatureOffsetC: number;
  soilMoistureScale: number;
  soilMoistureOffsetPct: number;
}

/** Calibrated, still-fresh ground conditions measured inside one zone. */
export interface LocalConditions {
  zoneId: number;
  observedAt: string;
  temperatureC: number | null;
  soilMoisturePct: number | null;
  /** Which sensor it came from, so an escalation can name its evidence. */
  deviceId: string;
}

/**
 * Calibration applied in SQL so read and write agree by construction.
 * `scale`/`offset` are the two terms a field calibration actually produces.
 */
const CALIBRATED = `
  CASE WHEN r.temperature_c_raw IS NULL THEN NULL
       ELSE r.temperature_c_raw + s.temperature_offset_c END      AS temperature_c,
  CASE WHEN r.soil_moisture_pct_raw IS NULL THEN NULL
       ELSE LEAST(100, GREATEST(0,
              r.soil_moisture_pct_raw * s.soil_moisture_scale
                + s.soil_moisture_offset_pct)) END                AS soil_moisture_pct
`;

@Injectable()
export class SensorService implements OnModuleInit {
  private readonly logger = new Logger(SensorService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly sensorAlerts: SensorAlertService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * How long a reading counts as ground truth.
   *
   * Past this it is context, never a decision input: a dead sensor must not
   * report calm on behalf of a wood that is drying out.
   */
  private get maxAgeMinutes(): number {
    return this.config.sensors.maxAgeMinutes;
  }

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  /**
   * Store one reading. Returns false when the device is unknown, which the
   * controller reports rather than swallowing: a gateway forwarding readings
   * nobody is recording should find that out from the response.
   */
  async record(reading: SensorReadingDto): Promise<boolean> {
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM ground_sensors WHERE device_id = $1 AND is_active;`,
      [reading.deviceId],
    );
    const sensor = rows[0];
    if (!sensor) return false;

    await this.db.query(
      `
      INSERT INTO sensor_readings
        (sensor_id, observed_at, temperature_c_raw, soil_moisture_pct_raw,
         relative_humidity_pct, battery_pct)
      VALUES ($1, $2, $3, $4, $5, $6)
      -- LoRaWAN retransmits an unacknowledged uplink; the same reading
      -- arriving twice must not become two rows.
      ON CONFLICT (sensor_id, observed_at) DO NOTHING;
      `,
      [
        sensor.id,
        reading.observedAt,
        reading.temperatureC ?? null,
        reading.soilMoisturePct ?? null,
        reading.relativeHumidityPct ?? null,
        reading.batteryPct ?? null,
      ],
    );

    await this.db.query(
      `UPDATE ground_sensors SET last_seen_at = now() WHERE id = $1;`,
      [sensor.id],
    );

    // The reading is stored; now ask whether it IS the alert. Never throws,
    // so a broken alert path cannot reject the evidence it runs on.
    await this.sensorAlerts.evaluate(Number(sensor.id), reading.observedAt);
    return true;
  }

  /** Every registered sensor with its latest calibrated state. */
  async findAll(): Promise<SensorStatus[]> {
    const { rows } = await this.db.query<{
      id: string;
      device_id: string;
      label: string;
      latitude: number;
      longitude: number;
      temperature_offset_c: number;
      soil_moisture_scale: number;
      soil_moisture_offset_pct: number;
      zone_id: string | null;
      last_seen_at: Date | null;
      observed_at: Date | null;
      temperature_c: number | null;
      soil_moisture_pct: number | null;
      battery_pct: number | null;
    }>(`
      SELECT s.id, s.device_id, s.label,
             ST_Y(s.geom) AS latitude,
             ST_X(s.geom) AS longitude,
             s.temperature_offset_c,
             s.soil_moisture_scale,
             s.soil_moisture_offset_pct,
             z.id AS zone_id,
             s.last_seen_at,
             r.observed_at,
             r.battery_pct,
             ${CALIBRATED}
      FROM ground_sensors s
      -- Which zone a sensor speaks for is derived from where it stands, not
      -- typed in: moving a zone boundary must not silently leave a sensor
      -- reporting for ground it is no longer on.
      LEFT JOIN high_risk_zones z
             ON z.is_active AND ST_Intersects(z.geom, s.geom)
      LEFT JOIN LATERAL (
        SELECT * FROM sensor_readings
         WHERE sensor_id = s.id
         ORDER BY observed_at DESC
         LIMIT 1
      ) r ON TRUE
      WHERE s.is_active
      ORDER BY s.label;
    `);

    const cutoff = Date.now() - this.maxAgeMinutes * 60_000;
    return rows.map((row) => ({
      id: Number(row.id),
      deviceId: row.device_id,
      label: row.label,
      latitude: row.latitude,
      longitude: row.longitude,
      zoneId: row.zone_id ? Number(row.zone_id) : null,
      lastSeenAt: row.observed_at?.toISOString() ?? null,
      reporting: !!row.observed_at && row.observed_at.getTime() >= cutoff,
      temperatureC: numberOrNull(row.temperature_c),
      soilMoisturePct: numberOrNull(row.soil_moisture_pct),
      batteryPct: numberOrNull(row.battery_pct),
      temperatureOffsetC: Number(row.temperature_offset_c),
      soilMoistureScale: Number(row.soil_moisture_scale),
      soilMoistureOffsetPct: Number(row.soil_moisture_offset_pct),
    }));
  }

  /**
   * The freshest usable reading inside each zone, keyed by zone id.
   *
   * Where several sensors share a zone, the most conservative reading wins —
   * the hottest temperature and the driest soil. One probe covers a few
   * square metres of a wood that is not uniform, so treating a sensor as
   * representative of its whole zone would be wrong in the dangerous
   * direction; taking the worst of them is wrong in the safe one.
   */
  async currentByZone(): Promise<Map<number, LocalConditions>> {
    const { rows } = await this.db.query<{
      zone_id: string;
      device_id: string;
      observed_at: Date;
      temperature_c: number | null;
      soil_moisture_pct: number | null;
    }>(
      `
      SELECT z.id AS zone_id, s.device_id, r.observed_at, ${CALIBRATED}
      FROM ground_sensors s
      JOIN high_risk_zones z
        ON z.is_active AND ST_Intersects(z.geom, s.geom)
      JOIN LATERAL (
        SELECT * FROM sensor_readings
         WHERE sensor_id = s.id
           AND observed_at >= now() - ($1 || ' minutes')::interval
         ORDER BY observed_at DESC
         LIMIT 1
      ) r ON TRUE
      WHERE s.is_active;
      `,
      [this.maxAgeMinutes],
    );

    const byZone = new Map<number, LocalConditions>();
    for (const row of rows) {
      const zoneId = Number(row.zone_id);
      const existing = byZone.get(zoneId);
      const candidate: LocalConditions = {
        zoneId,
        deviceId: row.device_id,
        observedAt: row.observed_at.toISOString(),
        temperatureC: numberOrNull(row.temperature_c),
        soilMoisturePct: numberOrNull(row.soil_moisture_pct),
      };
      byZone.set(zoneId, existing ? mostConservative(existing, candidate) : candidate);
    }
    return byZone;
  }

  /**
   * Register a sensor from the UI.
   *
   * A device id that already belongs to a RETIRED sensor re-activates it with
   * the new details — remounting a decommissioned probe is the natural
   * meaning of typing its id again, and its old readings stay attached, which
   * is exactly right: they are the drought record of wherever it stood. An
   * ACTIVE duplicate is refused: two live sensors claiming one identity would
   * merge two places into one reading.
   */
  async register(dto: RegisterSensorDto): Promise<{ id: number }> {
    const { rows } = await this.db.query<{ id: string }>(
      `
      INSERT INTO ground_sensors
        (device_id, label, geom,
         temperature_offset_c, soil_moisture_scale, soil_moisture_offset_pct)
      VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7)
      ON CONFLICT (device_id) DO UPDATE
        SET label                    = EXCLUDED.label,
            geom                     = EXCLUDED.geom,
            temperature_offset_c     = EXCLUDED.temperature_offset_c,
            soil_moisture_scale      = EXCLUDED.soil_moisture_scale,
            soil_moisture_offset_pct = EXCLUDED.soil_moisture_offset_pct,
            is_active                = TRUE
        WHERE ground_sensors.is_active = FALSE
      RETURNING id;
      `,
      [
        dto.deviceId,
        dto.label,
        dto.longitude,
        dto.latitude,
        dto.temperatureOffsetC ?? 0,
        dto.soilMoistureScale ?? 1,
        dto.soilMoistureOffsetPct ?? 0,
      ],
    );
    if (!rows[0]) {
      throw new ConflictException(
        `Device "${dto.deviceId}" is already registered and active.`,
      );
    }
    return { id: Number(rows[0].id) };
  }

  /** Edit a registered sensor — position, label, id or calibration. */
  async update(id: number, dto: RegisterSensorDto): Promise<void> {
    try {
      const { rowCount } = await this.db.query(
        `
        UPDATE ground_sensors
           SET device_id                = $2,
               label                    = $3,
               geom                     = ST_SetSRID(ST_MakePoint($4, $5), 4326),
               temperature_offset_c     = $6,
               soil_moisture_scale      = $7,
               soil_moisture_offset_pct = $8
         WHERE id = $1 AND is_active;
        `,
        [
          id,
          dto.deviceId,
          dto.label,
          dto.longitude,
          dto.latitude,
          dto.temperatureOffsetC ?? 0,
          dto.soilMoistureScale ?? 1,
          dto.soilMoistureOffsetPct ?? 0,
        ],
      );
      if (rowCount === 0) {
        throw new NotFoundException(`No active sensor with id ${id}.`);
      }
    } catch (error) {
      // Unique violation: the new device id belongs to another sensor.
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException(
          `Device "${dto.deviceId}" is already registered to another sensor.`,
        );
      }
      throw error;
    }
  }

  /**
   * Retire, never delete: the readings are the drought record of that spot,
   * and past evaluations that quoted this sensor must stay explicable.
   */
  async retire(id: number): Promise<void> {
    const { rowCount } = await this.db.query(
      `UPDATE ground_sensors SET is_active = FALSE WHERE id = $1 AND is_active;`,
      [id],
    );
    if (rowCount === 0) {
      throw new NotFoundException(`No active sensor with id ${id}.`);
    }
  }

  /** Registry table plus readings; idempotent DDL, like the rest. */
  private async ensureSchema(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS ground_sensors (
        id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        -- The network server's device id. Unique: two sensors claiming one
        -- identity would silently average two places into one reading.
        device_id                TEXT NOT NULL UNIQUE,
        label                    TEXT NOT NULL,
        geom                     geometry(Point, 4326) NOT NULL,
        -- Field calibration. Defaults are the identity transform, so an
        -- uncalibrated sensor reports exactly what it measured.
        temperature_offset_c     DOUBLE PRECISION NOT NULL DEFAULT 0,
        soil_moisture_scale      DOUBLE PRECISION NOT NULL DEFAULT 1,
        soil_moisture_offset_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
        is_active                BOOLEAN NOT NULL DEFAULT TRUE,
        installed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at             TIMESTAMPTZ
      );
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_ground_sensors_geom
        ON ground_sensors USING GIST (geom);
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS sensor_readings (
        id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        sensor_id             BIGINT NOT NULL REFERENCES ground_sensors(id),
        observed_at           TIMESTAMPTZ NOT NULL,
        -- Raw, as measured. Calibration is applied on read (see the class
        -- comment) so a corrected calibration also corrects the past.
        temperature_c_raw     DOUBLE PRECISION,
        soil_moisture_pct_raw DOUBLE PRECISION,
        relative_humidity_pct DOUBLE PRECISION,
        battery_pct           DOUBLE PRECISION,
        received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_sensor_reading UNIQUE (sensor_id, observed_at)
      );
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_sensor_readings_recent
        ON sensor_readings (sensor_id, observed_at DESC);
    `);
    this.logger.log(
      `Ground sensor intake ready (readings usable for ${this.maxAgeMinutes} min)`,
    );
  }
}

/** Hotter and drier wins — see currentByZone. */
function mostConservative(a: LocalConditions, b: LocalConditions): LocalConditions {
  return {
    zoneId: a.zoneId,
    // Named after whichever reading actually drove the temperature, since
    // that is the one an escalation would be quoting.
    deviceId: (b.temperatureC ?? -Infinity) > (a.temperatureC ?? -Infinity)
      ? b.deviceId
      : a.deviceId,
    observedAt: a.observedAt > b.observedAt ? a.observedAt : b.observedAt,
    temperatureC: pick(a.temperatureC, b.temperatureC, Math.max),
    soilMoisturePct: pick(a.soilMoisturePct, b.soilMoisturePct, Math.min),
  };
}

function pick(
  a: number | null,
  b: number | null,
  choose: (x: number, y: number) => number,
): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return choose(a, b);
}

/** pg hands back DOUBLE PRECISION as a number, but NULL as null. */
function numberOrNull(value: number | null): number | null {
  return value === null || value === undefined ? null : Number(value);
}
