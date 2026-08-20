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

import { Injectable } from '@nestjs/common';

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
}

const HISTORY_SQL = `
  SELECT ve.alert_level,
         ve.temperature_c,
         ve.soil_moisture_pct,
         ve.evaluated_at,
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
    AND ($2::boolean IS FALSE OR ve.alert_level LIKE 'CRITICAL%')
  ORDER BY ve.evaluated_at DESC
  LIMIT $3;
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
    }>(HISTORY_SQL, [query.sinceHours, query.criticalOnly, query.limit]);

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
    }));
  }
}
