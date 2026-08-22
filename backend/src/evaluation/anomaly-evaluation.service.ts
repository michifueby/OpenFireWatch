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
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import IORedis from 'ioredis';

import { APP_CONFIG, AppConfig } from '../config/environment';
import { createRedis, quitAll, redisOptions } from '../redis/redis.factory';

import { DatabaseService } from '../database/database.service';
import { RiskZone, RiskZoneService } from '../risk-zones/risk-zone.service';
import { SensorService } from '../sensors/sensor.service';
import {
  AlertLevel,
  isCritical,
  SMOULDERING,
} from './alert-level.enum';
import { decide } from './alert-decision';
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
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();

    // The publisher answers a single PUBLISH per verdict, so it fails fast;
    // the queue and worker block on the broker and must not.
    this.publisher = createRedis(this.config, 'request');
    this.deadLetterQueue = new Queue(DEAD_LETTER_QUEUE, {
      connection: redisOptions(this.config, 'stream'),
    });

    this.worker = new Worker(
      DETECTION_REPORTS_QUEUE,
      (job: Job) => this.evaluate(job),
      { connection: redisOptions(this.config, 'stream'), concurrency: 5 },
    );

    // Permanent failures (retries exhausted or unrecoverable) → DLQ.
    // `void` on an async listener, deliberately: BullMQ expects a synchronous
    // handler, and an async one that rejects escapes as an unhandled rejection
    // — which Node 22 turns into a process exit. The work is wrapped in its
    // own try/catch below, so nothing can escape.
    this.worker.on('failed', (job, error) => {
      void (async (): Promise<void> => {
        const unrecoverable = error.name === 'UnrecoverableError';
        if (!job || (!unrecoverable && job.attemptsMade < (job.opts.attempts ?? 1))) {
          return;
        }
        try {
          await this.deadLetterQueue.add('dead-letter', {
            sourceQueue: DETECTION_REPORTS_QUEUE,
            payload: job.data as unknown,
            error: error.message,
            attempts: job.attemptsMade,
            failedAt: new Date().toISOString(),
          });
        } catch (dlqError) {
          // Last line of defense: if even the DLQ is unreachable, scream.
          this.logger.error(`DLQ write failed: ${(dlqError as Error).message}`);
        }
      })();
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
    // A replay from the archive. Same rule, same tables — but history: no
    // alarm, no page, no marker, and no borrowing today's sensor readings.
    const backfilled = report.ingestion === 'backfill';

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
      await job.log('Duplicate detection — already evaluated, skipping');
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
    // The decision itself is a pure function (alert-decision.ts) so it can be
    // checked at every threshold boundary without a database. Everything this
    // method does around it — validating, persisting, logging, publishing —
    // is I/O, and none of it belongs inside the rule.

    // Evidence first: a weak source that has persisted across passes is
    // something ALREADY burning, so it outranks the hazard profiles, which
    // only predict that ignition is likely.
    //
    // THIS detection must itself be weak. Otherwise a fresh, powerful fire
    // breaking out where embers had been smouldering would inherit the old
    // weak history and be reported as a smouldering nest — understating an
    // active fire, the one direction this system must never fail in.
    const currentIsWeak = (detection.frpMw ?? 0) <= SMOULDERING.MAX_FRP_MW;
    const smouldering =
      zone && currentIsWeak
        ? await this.detectSmouldering(detection.longitude, detection.latitude)
        : null;

    // A live sensor inside this zone, if one is standing there and reporting.
    // SensorService.currentByZone already drops stale readings: a dead sensor
    // must never report calm on behalf of a wood that is drying out. Never
    // for a backfilled detection: a probe reading from this afternoon says
    // nothing about a July in 2019.
    const local =
      zone && !backfilled ? (await this.sensors.currentByZone()).get(zone.id) : undefined;

    const decision = decide({
      hazardType: zone?.hazardType ?? null,
      confidence: detection.confidence,
      regional: {
        temperatureC: weather.temperatureC,
        soilMoisturePct: weather.soilMoisturePct,
      },
      local: local
        ? {
            temperatureC: local.temperatureC ?? undefined,
            soilMoisturePct: local.soilMoisturePct ?? undefined,
            deviceId: local.deviceId,
          }
        : undefined,
      smouldering,
    });

    const { level, withheldBecause } = decision;
    const decisionTemperatureC = decision.conditions.temperatureC;
    const decisionSoilMoisturePct = decision.conditions.soilMoisturePct;

    // -- 5) Persist the VALIDATED evaluation result ----------------------------
    await this.db.query(
      `
      INSERT INTO validated_events
        (anomaly_id, zone_id, alert_level, temperature_c, soil_moisture_pct, backfilled)
      VALUES ($1, $2, $3, $4, $5, $6);
      `,
      [anomalyId, zone?.id ?? null, level, decisionTemperatureC, decisionSoilMoisturePct, backfilled],
    );

    // -- 6) Log & escalate ------------------------------------------------------
    if (backfilled) {
      // History is logged quietly: a decade of replayed summers must not
      // fill the operator log with alarms nobody can act on.
      this.logger.debug(`backfill: anomaly #${anomalyId} (${detection.acquiredAt}) → ${level}`);
    } else if (isCritical(level)) {
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
    // Never for a backfilled detection: that channel is also what pages the
    // crew, and the map would pulse red over a fire that went out years ago.
    if (level !== AlertLevel.INFO && !backfilled) {
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
    // Replayed from the satellite archive. Every query that describes the
    // LIVE picture — what is outstanding, what to escalate, what the panel
    // lists — excludes these; the incident register, which asks what the
    // system would have done on a given day, includes them. That is the whole
    // point of having them.
    await this.db.query(`
      ALTER TABLE validated_events
        ADD COLUMN IF NOT EXISTS backfilled BOOLEAN NOT NULL DEFAULT FALSE;
    `);
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
    // The worker first: it must stop taking jobs before the connections it
    // runs them on go away.
    await Promise.allSettled([this.worker?.close(), this.deadLetterQueue?.close()]);
    await quitAll(this.publisher);
  }
}
