/**
 * AnomalyEvaluationService — the core domain logic of OpenFireWatch.
 *
 * Consumes validated detection reports from the BullMQ/Redis queue and
 * implements the phosphorus business rule:
 *
 *   IF   a new thermal anomaly is detected
 *   AND  it lies inside a `high_risk_zones` polygon      (PostGIS ST_Intersects)
 *   AND  it satisfies the criteria of THAT ZONE'S hazard type
 *        (HAZARD_PROFILES in alert-level.enum.ts — white phosphorus needs the
 *         30 °C / 20 % soil-moisture window, a forest fire needs only a
 *         credible detection, ammunition sites escalate unconditionally)
 *   THEN escalate to that hazard's CRITICAL_* level, persist the validated
 *        event, log a high-priority warning, and broadcast via Socket.IO.
 *
 * In-zone detections that miss their criteria become ELEVATED (still
 * broadcast — responders want to see activity inside hazard areas);
 * out-of-zone detections are recorded as INFO and not broadcast.
 *
 * Reliability contract: any throw inside the processor lets BullMQ retry
 * with exponential backoff; validation failures throw UnrecoverableError
 * (retrying malformed data is pointless) and permanent failures are copied
 * to the dead letter queue.
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import IORedis from 'ioredis';

import { DatabaseService } from '../database/database.service';
import { RiskZone, RiskZoneService } from '../risk-zones/risk-zone.service';
import { SensorService } from '../sensors/sensor.service';
import {
  AlertLevel,
  isCredibleDetection,
  isCritical,
  PHOSPHORUS_IGNITION,
  profileFor,
  SMOULDERING,
} from './alert-level.enum';
import { DetectionReportDto } from './detection-report.dto';

/**
 * Queue/channel names — must match the workers' `BUS` constants.
 * BullMQ queue names must not contain ":" (Redis key separator); the plain
 * pub/sub channel has no such restriction.
 */
const DETECTION_REPORTS_QUEUE = 'events.detection-reports';
const DEAD_LETTER_QUEUE = 'dlq.ingestion';
const ALERTS_CHANNEL = 'alerts:anomalies';

/**
 * Does this location show the persistence signature of a smouldering nest?
 *
 * Counts DISTINCT acquisition times of weak detections near the point inside
 * the look-back window — several separate satellite passes seeing a low-power
 * source at the same spot.
 *
 * The `&&` bounding-box test comes first on purpose: it is what the GiST index
 * on `geom` can answer, so the exact metric distance is only computed for the
 * handful of rows that survive it. Casting every row to geography up front
 * would ignore the index and scan the table.
 */
const SMOULDERING_SQL = `
  SELECT count(DISTINCT acquired_at)::int AS passes,
         COALESCE(max(frp_mw), 0)         AS peak_frp,
         min(acquired_at)                 AS first_seen
  FROM thermal_anomalies
  WHERE geom && ST_Expand(ST_SetSRID(ST_MakePoint($1, $2), 4326), $3)
    AND ST_DWithin(
          geom::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          $4)
    AND acquired_at >= now() - ($5 || ' hours')::interval
    AND COALESCE(frp_mw, 0) <= $6;
`;

/** The alert payload broadcast to the Angular frontend (via AlertsGateway). */
export interface AnomalyAlertPayload {
  type: 'thermal_anomaly';
  id: number;
  latitude: number;
  longitude: number;
  acquiredAt: string;
  level: AlertLevel;
  zone: RiskZone | null;
  weather: {
    temperatureC: number;
    soilMoisturePct: number;
  };
  /** Present only on CRITICAL_SMOULDERING — the evidence behind the call. */
  smouldering?: {
    passes: number;
    windowHours: number;
    peakFrpMw: number;
  };
}

@Injectable()
export class AnomalyEvaluationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnomalyEvaluationService.name);

  private worker!: Worker;
  private deadLetterQueue!: Queue;
  /** Dedicated publisher connection (a subscriber connection cannot publish). */
  private publisher!: IORedis;

  constructor(
    private readonly db: DatabaseService,
    private readonly riskZones: RiskZoneService,
    private readonly sensors: SensorService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();

    const connectionOptions = {
      host: process.env.REDIS_HOST ?? 'redis',
      port: Number(process.env.REDIS_PORT ?? 6379),
      // Logical Redis DB index — lets test runs isolate from dev queues.
      db: Number(process.env.REDIS_DB ?? 0),
      // Required by BullMQ: block-and-wait through broker hiccups.
      maxRetriesPerRequest: null as null,
    };

    this.publisher = new IORedis({ ...connectionOptions, maxRetriesPerRequest: 3 });
    this.deadLetterQueue = new Queue(DEAD_LETTER_QUEUE, {
      connection: { ...connectionOptions },
    });

    this.worker = new Worker(
      DETECTION_REPORTS_QUEUE,
      (job: Job) => this.evaluate(job),
      { connection: { ...connectionOptions }, concurrency: 5 },
    );

    // Permanent failures (retries exhausted or unrecoverable) → DLQ.
    this.worker.on('failed', async (job, error) => {
      const unrecoverable = error.name === 'UnrecoverableError';
      if (!job || (!unrecoverable && job.attemptsMade < (job.opts.attempts ?? 1))) {
        return;
      }
      try {
        await this.deadLetterQueue.add('dead-letter', {
          sourceQueue: DETECTION_REPORTS_QUEUE,
          payload: job.data,
          error: error.message,
          attempts: job.attemptsMade,
          failedAt: new Date().toISOString(),
        });
      } catch (dlqError) {
        // Last line of defense: if even the DLQ is unreachable, scream.
        this.logger.error(`DLQ write failed: ${(dlqError as Error).message}`);
      }
    });

    this.logger.log(`Evaluating detection reports from "${DETECTION_REPORTS_QUEUE}"`);
  }

  /**
   * Evaluate ONE detection report end-to-end.
   * Returns the alert level for observability (visible in BullMQ job results).
   */
  private async evaluate(job: Job): Promise<AlertLevel | 'DUPLICATE'> {
    // -- 1) Re-validate at the trust boundary --------------------------------
    const report = plainToInstance(DetectionReportDto, job.data);
    const errors = await validate(report, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
    if (errors.length > 0) {
      throw new UnrecoverableError(
        `Detection report failed validation: ${errors.map(String).join('; ')}`,
      );
    }
    const { detection, weather } = report;

    // -- 2) Persist the raw anomaly (idempotent) ------------------------------
    // ON CONFLICT DO NOTHING + RETURNING: a duplicate satellite pass returns
    // zero rows, short-circuiting evaluation — the event was already handled.
    const inserted = await this.db.query<{ id: number }>(
      `
      INSERT INTO thermal_anomalies
        (source, satellite, geom, acquired_at, brightness_k, frp_mw, confidence, weather)
      VALUES
        ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8, $9)
      ON CONFLICT ON CONSTRAINT uq_thermal_anomaly_detection DO NOTHING
      RETURNING id;
      `,
      [
        detection.source,
        detection.satellite ?? null,
        detection.longitude, // ST_MakePoint(x, y) = (longitude, latitude)!
        detection.latitude,
        detection.acquiredAt,
        detection.brightnessK ?? null,
        detection.frpMw ?? null,
        detection.confidence ?? null,
        JSON.stringify(weather),
      ],
    );
    const insertedRow = inserted.rows[0];
    if (!insertedRow) {
      job.log('Duplicate detection — already evaluated, skipping');
      return 'DUPLICATE';
    }
    // pg returns BIGINT as a string — coerce once at the boundary.
    const anomalyId = Number(insertedRow.id);

    // -- 3) Spatial rule: inside a high-risk zone? (PostGIS ST_Intersects) ----
    const zones = await this.riskZones.findZonesContaining(
      detection.longitude,
      detection.latitude,
    );
    const zone: RiskZone | null = zones[0] ?? null;

    // -- 4) Hazard rule: the criteria depend on WHAT the zone protects --------
    // Each hazard type declares its own gate (see HAZARD_PROFILES): the
    // phosphorus mechanism is weather-driven, a forest fire is not, and heat
    // at an ammunition site is critical unconditionally.
    let level: AlertLevel;
    let withheldBecause: string | null = null;

    let smouldering: AnomalyAlertPayload['smouldering'];

    // The conditions the verdict is based on. Regional estimate by default,
    // replaced by measured ground truth when a live sensor stands in the
    // zone — and then persisted and broadcast AS the decision inputs, so an
    // alert never displays numbers the rule did not run on.
    let decisionTemperatureC = weather.temperatureC;
    let decisionSoilMoisturePct = weather.soilMoisturePct;

    if (!zone) {
      level = AlertLevel.INFO;
    } else {
      // Evidence first: a weak source that has persisted across passes is
      // something ALREADY burning, so it outranks the hazard profiles, which
      // only predict that ignition is likely.
      //
      // THIS detection must itself be weak. Otherwise a fresh, powerful fire
      // breaking out where embers had been smouldering would inherit the old
      // weak history and be reported as a smouldering nest — understating an
      // active fire, the one direction this system must never fail in.
      const currentIsWeak =
        (detection.frpMw ?? 0) <= SMOULDERING.MAX_FRP_MW;
      const persistence = currentIsWeak
        ? await this.detectSmouldering(detection.longitude, detection.latitude)
        : null;
      if (persistence) {
        smouldering = persistence;
      }

      const profile = profileFor(zone.hazardType);

      // Ground truth beats the regional estimate. The report's weather is one
      // TAWES station and one grid point standing in for the whole monitored
      // area; a live sensor inside THIS zone measures the soil the rule is
      // actually about. Substituted field-by-field — a sensor without a soil
      // probe still improves the temperature — and only while fresh: a dead
      // sensor must never report calm on behalf of a wood that is drying out
      // (SensorService.currentByZone already enforces the freshness window).
      const local = (await this.sensors.currentByZone()).get(zone.id);
      decisionTemperatureC = local?.temperatureC ?? weather.temperatureC;
      decisionSoilMoisturePct = local?.soilMoisturePct ?? weather.soilMoisturePct;
      const groundSource = local
        ? `sensor ${local.deviceId}`
        : 'regional estimate';

      // Phosphorus gate — both conditions must hold SIMULTANEOUSLY.
      const ignitionTemperatureReached =
        decisionTemperatureC >= PHOSPHORUS_IGNITION.IGNITION_TEMPERATURE_C;
      const soilCrackedAndDry =
        decisionSoilMoisturePct < PHOSPHORUS_IGNITION.CRITICAL_SOIL_MOISTURE_PCT;
      const weatherOk =
        !profile.requiresIgnitionWeather ||
        (ignitionTemperatureReached && soilCrackedAndDry);

      // Credibility gate — suppress pixels the satellite itself rates low.
      const credibilityOk =
        !profile.requiresCredibleDetection ||
        isCredibleDetection(detection.confidence);

      if (smouldering) {
        level = AlertLevel.CRITICAL_SMOULDERING;
      } else if (weatherOk && credibilityOk) {
        level = profile.criticalLevel;
      } else {
        level = AlertLevel.ELEVATED;
        // Recording WHY it stayed below critical makes an ELEVATED entry
        // actionable instead of merely puzzling.
        withheldBecause = !weatherOk
          ? `ignition preconditions not met (${decisionTemperatureC}°C, soil ` +
            `${decisionSoilMoisturePct}% — ${groundSource})`
          : `satellite confidence rated low ("${detection.confidence}")`;
      }
    }

    // -- 5) Persist the VALIDATED evaluation result ----------------------------
    await this.db.query(
      `
      INSERT INTO validated_events
        (anomaly_id, zone_id, alert_level, temperature_c, soil_moisture_pct)
      VALUES ($1, $2, $3, $4, $5);
      `,
      [anomalyId, zone?.id ?? null, level, decisionTemperatureC, decisionSoilMoisturePct],
    );

    // -- 6) Log & escalate ------------------------------------------------------
    if (isCritical(level)) {
      // High-priority operator log: everything a responder needs on one line.
      this.logger.error(
        `🚨 ${level} — anomaly #${anomalyId} inside "${zone!.name.en}" ` +
          `[${zone!.hazardType}] at (${detection.latitude}, ${detection.longitude}): ` +
          `${decisionTemperatureC}°C, soil ${decisionSoilMoisturePct}%, ` +
          `confidence ${detection.confidence ?? 'n/a'}` +
          (smouldering
            ? ` — persisted across ${smouldering.passes} passes in ${smouldering.windowHours} h, ` +
              `peak ${smouldering.peakFrpMw} MW`
            : ''),
      );
    } else if (level === AlertLevel.ELEVATED) {
      this.logger.warn(
        `ELEVATED — anomaly #${anomalyId} inside "${zone!.name.en}" ` +
          `[${zone!.hazardType}]: ${withheldBecause}`,
      );
    }

    // -- 7) Broadcast in-zone alerts via WebSockets -----------------------------
    // Published on the Redis channel that AlertsGateway subscribes to; every
    // stateless API replica relays it to its Socket.IO clients as "anomaly:new".
    if (level !== AlertLevel.INFO) {
      const payload: AnomalyAlertPayload = {
        type: 'thermal_anomaly',
        id: anomalyId,
        latitude: detection.latitude,
        longitude: detection.longitude,
        acquiredAt: detection.acquiredAt,
        level,
        zone,
        weather: {
          temperatureC: decisionTemperatureC,
          soilMoisturePct: decisionSoilMoisturePct,
        },
        ...(smouldering ? { smouldering } : {}),
      };
      await this.publisher.publish(ALERTS_CHANNEL, JSON.stringify(payload));
    }

    return level;
  }

  /**
   * Look for the persistence signature of a smouldering nest around a point.
   * Returns the supporting evidence, or null when the criteria are not met.
   */
  private async detectSmouldering(
    longitude: number,
    latitude: number,
  ): Promise<AnomalyAlertPayload['smouldering'] | null> {
    // The bounding-box prefilter works in degrees; ~1° latitude = 111 km.
    const radiusDegrees = SMOULDERING.RADIUS_METRES / 111_000;
    const { rows } = await this.db.query<{
      passes: number;
      peak_frp: string | number;
      first_seen: Date | null;
    }>(SMOULDERING_SQL, [
      longitude,
      latitude,
      radiusDegrees,
      SMOULDERING.RADIUS_METRES,
      SMOULDERING.WINDOW_HOURS,
      SMOULDERING.MAX_FRP_MW,
    ]);

    const row = rows[0];
    if (!row || row.passes < SMOULDERING.MIN_PASSES) return null;

    return {
      passes: row.passes,
      windowHours: SMOULDERING.WINDOW_HOURS,
      peakFrpMw: Math.round(Number(row.peak_frp) * 10) / 10,
    };
  }

  /**
   * Evaluation results table (idempotent DDL; real deployments: migrations).
   * Keeps the raw observation AND the verdict — auditable after the fact.
   */
  private async ensureSchema(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS validated_events (
        id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        anomaly_id         BIGINT NOT NULL REFERENCES thermal_anomalies(id),
        zone_id            BIGINT REFERENCES high_risk_zones(id),
        alert_level        TEXT NOT NULL,
        temperature_c      DOUBLE PRECISION NOT NULL,
        soil_moisture_pct  DOUBLE PRECISION NOT NULL,
        evaluated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Acknowledgement, added additively so databases created by an earlier
    // release keep working. Written by AlertHistoryService (AlertsModule) and
    // read by every query that asks what is still outstanding; the column
    // lives here because this service owns the table.
    //
    // No `acknowledged_by`: there are no accounts yet, so it could only hold
    // a free-text name — friction in an emergency, and an unverified string
    // that looks like an audit trail without being one. ApiKeyGuard is what
    // limits who may acknowledge, and it is the seam where real accounts slot
    // in (see its own note).
    await this.db.query(`
      ALTER TABLE validated_events
        ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
    `);
    // What the crew found when they went. Unlike acknowledged_at — which
    // keeps its first timestamp, because "who took it first" is a fact — an
    // outcome may be overwritten: it records what turned out to be true, and
    // corrections to that are legitimate.
    await this.db.query(`
      ALTER TABLE validated_events
        ADD COLUMN IF NOT EXISTS outcome    TEXT,
        ADD COLUMN IF NOT EXISTS outcome_at TIMESTAMPTZ;
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_validated_events_level_time
        ON validated_events (alert_level, evaluated_at DESC);
    `);
    // Partial index: "which criticals are still outstanding" is the query the
    // dashboard runs on every page load, and it only ever looks at the rows
    // that are still NULL here.
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_validated_events_unacknowledged
        ON validated_events (evaluated_at DESC)
        WHERE acknowledged_at IS NULL;
    `);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.worker?.close(),
      this.deadLetterQueue?.close(),
      this.publisher?.quit(),
    ]);
  }
}
