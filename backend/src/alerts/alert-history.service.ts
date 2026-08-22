/**
 * AlertHistoryService — read access to past evaluations.
 *
 * `validated_events` has recorded every verdict since the first deployment,
 * but nothing ever read it back: the dashboard only showed alerts that
 * arrived over the WebSocket while a tab happened to be open, so a page
 * reload wiped the picture. For a system whose whole purpose is to notice
 * things when nobody is watching, that was the wrong way round.
 *
 * Entries are shaped exactly like the live WebSocket payload so the frontend
 * can render history and live alerts with the same component — plus
 * `evaluatedAt`, which live alerts do not carry.
 */

import { Injectable, NotFoundException } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import { QueryAlertsDto } from './query-alerts.dto';

/** One past evaluation, mirroring AnomalyAlertPayload. */
export interface AlertHistoryEntry {
  type: 'thermal_anomaly';
  id: number;
  latitude: number;
  longitude: number;
  acquiredAt: string;
  evaluatedAt: string;
  level: string;
  source: string;
  zone: { id: number; name: { en: string; de: string }; hazardType: string } | null;
  weather: { temperatureC: number; soilMoisturePct: number };
  /** When somebody took responsibility for this alert, or null if nobody has. */
  acknowledgedAt: string | null;
  /** What the crew found: 'confirmed', 'nothing_found', or null. */
  outcome: string | null;
}

const HISTORY_SQL = `
  SELECT ve.alert_level,
         ve.temperature_c,
         ve.soil_moisture_pct,
         ve.evaluated_at,
         ve.acknowledged_at,
         ve.outcome,
         a.id  AS anomaly_id,
         a.source,
         a.acquired_at,
         ST_X(a.geom) AS longitude,
         ST_Y(a.geom) AS latitude,
         z.id  AS zone_id,
         z.name,
         z.name_en,
         z.name_de,
         z.hazard_type
  FROM validated_events ve
  JOIN thermal_anomalies a ON a.id = ve.anomaly_id
  -- LEFT JOIN: INFO events have no zone, and dropping them would silently
  -- hide the "detected but outside every zone" case from the history.
  LEFT JOIN high_risk_zones z ON z.id = ve.zone_id
  WHERE ve.evaluated_at >= now() - ($1 || ' hours')::interval
    AND NOT ve.backfilled
    AND ($2::boolean IS FALSE OR ve.alert_level LIKE 'CRITICAL%')
    AND ($3::boolean IS FALSE OR ve.acknowledged_at IS NULL)
  ORDER BY ve.evaluated_at DESC
  LIMIT $4;
`;

/**
 * Acknowledgement is keyed by anomaly, not by evaluation row: the anomaly id
 * is what the alert payload carries and what a responder sees on screen, and
 * re-evaluating the same detection must not resurrect an alert somebody has
 * already taken.
 *
 * `WHERE acknowledged_at IS NULL` keeps the first acknowledgement's timestamp
 * rather than overwriting it, so a second click never rewrites when it
 * happened. RETURNING is empty in that case, which the caller distinguishes
 * from "no such alert" by looking the anomaly up separately.
 */
const ACKNOWLEDGE_SQL = `
  UPDATE validated_events
     SET acknowledged_at = now()
   WHERE anomaly_id = $1
     AND acknowledged_at IS NULL
  RETURNING acknowledged_at;
`;

@Injectable()
export class AlertHistoryService {
  constructor(private readonly db: DatabaseService) {}

  async find(query: QueryAlertsDto): Promise<AlertHistoryEntry[]> {
    const { rows } = await this.db.query<{
      alert_level: string;
      temperature_c: string | number;
      soil_moisture_pct: string | number;
      evaluated_at: Date;
      acknowledged_at: Date | null;
      outcome: string | null;
      anomaly_id: string;
      source: string;
      acquired_at: Date;
      longitude: number;
      latitude: number;
      zone_id: string | null;
      name: string | null;
      name_en: string | null;
      name_de: string | null;
      hazard_type: string | null;
    }>(HISTORY_SQL, [
      query.sinceHours,
      query.criticalOnly,
      query.unacknowledgedOnly,
      query.limit,
    ]);

    return rows.map((row) => ({
      type: 'thermal_anomaly' as const,
      // pg returns BIGINT as a string — coerce at the boundary.
      id: Number(row.anomaly_id),
      latitude: row.latitude,
      longitude: row.longitude,
      acquiredAt: row.acquired_at.toISOString(),
      evaluatedAt: row.evaluated_at.toISOString(),
      level: row.alert_level,
      source: row.source,
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
      weather: {
        temperatureC: Number(row.temperature_c),
        soilMoisturePct: Number(row.soil_moisture_pct),
      },
      acknowledgedAt: row.acknowledged_at?.toISOString() ?? null,
      outcome: row.outcome,
    }));
  }

  /**
   * Record that somebody has taken this alert.
   *
   * Idempotent: acknowledging an already-acknowledged alert returns the
   * original timestamp instead of failing. Two responders pressing the button
   * within the same second is a normal thing to happen, not an error worth
   * showing either of them.
   */
  async acknowledge(anomalyId: number): Promise<{ acknowledgedAt: string }> {
    const { rows } = await this.db.query<{ acknowledged_at: Date }>(
      ACKNOWLEDGE_SQL,
      [anomalyId],
    );
    if (rows[0]) return { acknowledgedAt: rows[0].acknowledged_at.toISOString() };

    // Nothing updated: either already acknowledged, or no such alert. Only
    // the second is a client error worth reporting.
    const { rows: existing } = await this.db.query<{ acknowledged_at: Date }>(
      `SELECT acknowledged_at FROM validated_events
        WHERE anomaly_id = $1 AND acknowledged_at IS NOT NULL
        ORDER BY acknowledged_at LIMIT 1;`,
      [anomalyId],
    );
    if (existing[0]) {
      return { acknowledgedAt: existing[0].acknowledged_at.toISOString() };
    }
    throw new NotFoundException(`No evaluated alert for anomaly ${anomalyId}.`);
  }

  /**
   * Record what the crew found. Overwrites are allowed — see the schema note:
   * an outcome states what turned out to be true, and correcting it is
   * legitimate in a way that rewriting an acknowledgement would not be.
   */
  async setOutcome(
    anomalyId: number,
    outcome: 'confirmed' | 'nothing_found',
  ): Promise<void> {
    const { rowCount } = await this.db.query(
      `UPDATE validated_events
          SET outcome = $2, outcome_at = now()
        WHERE anomaly_id = $1;`,
      [anomalyId, outcome],
    );
    if (rowCount === 0) {
      throw new NotFoundException(`No evaluated alert for anomaly ${anomalyId}.`);
    }
  }
}
