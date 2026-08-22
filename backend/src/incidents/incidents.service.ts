/**
 * IncidentsService — the register of what actually happened, and the
 * comparison that makes the thresholds testable.
 *
 * Everything else this system produces is computed from assumptions: the
 * 30 °C and 20 % come from literature on white phosphorus, and the forecast
 * and the seasonal history both inherit them. Until real events are laid
 * against those computations, nobody can say whether the assumptions describe
 * this particular wood.
 *
 * This service closes that loop. Each recorded fire is checked against two
 * questions, answered from data the system already holds:
 *
 *   - Was the ignition window OPEN at that hour? (zone_weather_history —
 *     the same decade of reanalysis the seasonal analysis runs on)
 *   - Did the system raise a critical alert around that time? (the alert
 *     record, 48 h before to 12 h after)
 *
 * Together with the outcome a crew records on an alert ("confirmed" /
 * "nothing found"), that yields the two numbers no warning system likes to
 * publish and every operator should know: hit rate and false-alarm rate.
 *
 * Incidents are DELETED, not retired, unlike zones and sensors. Those are
 * referenced by the system's own records; an incident is operator-entered
 * data that nothing references, and a wrong entry corrected by deletion is
 * more honest than a wrong entry kept forever.
 */

import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import { PHOSPHORUS_IGNITION } from '../evaluation/alert-level.enum';
import { IncidentKind, RegisterIncidentDto } from './incident.dto';

/** One recorded event, with its validation verdicts. */
export interface IncidentEntry {
  id: number;
  occurredAt: string;
  latitude: number;
  longitude: number;
  kind: IncidentKind;
  title: string;
  notes: string | null;
  /** Derived from position, like sensors — never typed in. */
  zone: { id: number; name: { de: string; en: string } } | null;
  /**
   * Whether the ignition window was open in that hour. Null when the question
   * does not apply: no zone, a non-weather-gated zone, or no weather history
   * for that hour.
   */
  inIgnitionWindow: boolean | null;
  /**
   * Whether any satellite detection lies within 2 km, 48 h before to 12 h
   * after — did the instrument see it at all, whatever the rule made of it.
   */
  satelliteSeen: boolean;
  /** Whether a critical alert was raised 48 h before to 12 h after. */
  alertRaised: boolean;
}

export interface IncidentSummary {
  fires: number;
  /** Of the fires where the window question applies: how many fell inside. */
  firesInWindow: number;
  firesWindowApplicable: number;
  /** Fires the satellite saw at all, alarmed or not. */
  firesSeen: number;
  firesAlerted: number;
  /** Outcomes recorded on critical alerts, the other half of the loop. */
  alertsConfirmed: number;
  alertsNothingFound: number;
}

/**
 * The whole register in one query. LATERAL subqueries answer the two
 * validation questions per row; doing this in SQL keeps the hour-bucket
 * arithmetic next to the data instead of paging history into the process.
 */
const LIST_SQL = `
  SELECT i.id,
         i.occurred_at,
         ST_Y(i.geom) AS latitude,
         ST_X(i.geom) AS longitude,
         i.kind,
         i.title,
         i.notes,
         z.id       AS zone_id,
         z.name, z.name_de, z.name_en,
         z.hazard_type,
         window_check.in_window,
         -- Two questions, asked apart on purpose. "Did the satellite see it?"
         -- is about the instrument; "did the system alarm?" is about the
         -- rule. A fire that was seen but not alarmed is the thresholds'
         -- report card; one that was never seen is a limit of the sensor,
         -- and no threshold would have changed it.
         --
         -- Both use the ACQUISITION time, never the evaluation time: a
         -- detection replayed from the archive is evaluated years after the
         -- pass, and the question is about the pass.
         EXISTS (
           SELECT 1
             FROM thermal_anomalies a
            WHERE a.acquired_at BETWEEN i.occurred_at - interval '48 hours'
                                    AND i.occurred_at + interval '12 hours'
              AND ST_DWithin(a.geom::geography, i.geom::geography, 2000)
         ) AS satellite_seen,
         EXISTS (
           SELECT 1
             FROM validated_events ve
             JOIN thermal_anomalies a ON a.id = ve.anomaly_id
            WHERE ve.alert_level LIKE 'CRITICAL%'
              AND a.acquired_at BETWEEN i.occurred_at - interval '48 hours'
                                    AND i.occurred_at + interval '12 hours'
              AND (
                    (z.id IS NOT NULL AND ve.zone_id = z.id)
                 OR ST_DWithin(a.geom::geography, i.geom::geography, 2000)
                  )
         ) AS alert_raised
    FROM incidents i
    LEFT JOIN high_risk_zones z
           ON z.is_active AND ST_Intersects(z.geom, i.geom)
    LEFT JOIN LATERAL (
      SELECT bool_or(
               h.temperature_c >= $1 AND h.soil_moisture_pct < $2
             ) AS in_window
        FROM zone_weather_history h
       WHERE h.zone_id = z.id
         AND h.observed_at <= i.occurred_at
         AND i.occurred_at < h.observed_at + interval '1 hour'
    ) window_check ON z.hazard_type = 'white_phosphorus'
   ORDER BY i.occurred_at DESC;
`;

@Injectable()
export class IncidentsService implements OnModuleInit {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  async list(): Promise<{ incidents: IncidentEntry[]; summary: IncidentSummary }> {
    const { rows } = await this.db.query<{
      id: string;
      occurred_at: Date;
      latitude: number;
      longitude: number;
      kind: IncidentKind;
      title: string;
      notes: string | null;
      zone_id: string | null;
      name: string | null;
      name_de: string | null;
      name_en: string | null;
      in_window: boolean | null;
      satellite_seen: boolean;
      alert_raised: boolean;
    }>(LIST_SQL, [
      PHOSPHORUS_IGNITION.IGNITION_TEMPERATURE_C,
      PHOSPHORUS_IGNITION.CRITICAL_SOIL_MOISTURE_PCT,
    ]);

    const incidents: IncidentEntry[] = rows.map((row) => ({
      id: Number(row.id),
      occurredAt: row.occurred_at.toISOString(),
      latitude: row.latitude,
      longitude: row.longitude,
      kind: row.kind,
      title: row.title,
      notes: row.notes,
      zone: row.zone_id
        ? {
            id: Number(row.zone_id),
            name: {
              de: row.name_de ?? row.name ?? '',
              en: row.name_en ?? row.name ?? '',
            },
          }
        : null,
      inIgnitionWindow: row.in_window,
      satelliteSeen: row.satellite_seen,
      alertRaised: row.alert_raised,
    }));

    return { incidents, summary: await this.summarise(incidents) };
  }

  private async summarise(incidents: IncidentEntry[]): Promise<IncidentSummary> {
    const fires = incidents.filter((i) => i.kind === 'fire');
    const applicable = fires.filter((i) => i.inIgnitionWindow !== null);

    const { rows } = await this.db.query<{ outcome: string; n: string }>(
      `SELECT outcome, count(*) AS n FROM validated_events
        WHERE outcome IS NOT NULL GROUP BY outcome;`,
    );
    const outcomeCount = (name: string): number =>
      Number(rows.find((r) => r.outcome === name)?.n ?? 0);

    return {
      fires: fires.length,
      firesWindowApplicable: applicable.length,
      firesInWindow: applicable.filter((i) => i.inIgnitionWindow).length,
      firesSeen: fires.filter((i) => i.satelliteSeen).length,
      firesAlerted: fires.filter((i) => i.alertRaised).length,
      alertsConfirmed: outcomeCount('confirmed'),
      alertsNothingFound: outcomeCount('nothing_found'),
    };
  }

  async create(dto: RegisterIncidentDto): Promise<{ id: number }> {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO incidents (occurred_at, geom, kind, title, notes)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $5, $6)
       RETURNING id;`,
      [dto.occurredAt, dto.longitude, dto.latitude, dto.kind, dto.title, dto.notes ?? null],
    );
    return { id: Number(rows[0]!.id) };
  }

  async update(id: number, dto: RegisterIncidentDto): Promise<void> {
    const { rowCount } = await this.db.query(
      `UPDATE incidents
          SET occurred_at = $2,
              geom        = ST_SetSRID(ST_MakePoint($3, $4), 4326),
              kind        = $5,
              title       = $6,
              notes       = $7
        WHERE id = $1;`,
      [id, dto.occurredAt, dto.longitude, dto.latitude, dto.kind, dto.title, dto.notes ?? null],
    );
    if (rowCount === 0) throw new NotFoundException(`No incident with id ${id}.`);
  }

  async remove(id: number): Promise<void> {
    const { rowCount } = await this.db.query(`DELETE FROM incidents WHERE id = $1;`, [id]);
    if (rowCount === 0) throw new NotFoundException(`No incident with id ${id}.`);
  }

  private async ensureSchema(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        occurred_at TIMESTAMPTZ NOT NULL,
        geom        geometry(Point, 4326) NOT NULL,
        kind        TEXT NOT NULL,
        title       TEXT NOT NULL,
        notes       TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_incidents_geom ON incidents USING GIST (geom);
    `);
    this.logger.log('Incident register ready');
  }
}
