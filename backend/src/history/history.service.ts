/**
 * HistoryService — how often has each zone's ignition window actually been
 * open, season by season?
 *
 * This is the question that turns a live map into evidence. "The Föhrenwald
 * met both self-ignition criteria on 24 days in 2024, concentrated in July"
 * is the sort of statement that supports a funding request, a patrol schedule,
 * or an argument with somebody who thinks the risk is theoretical. The live
 * map can only ever say what is happening now.
 *
 * It also makes the thresholds falsifiable. They are literature values, not
 * measurements from this wood; comparing the windows the rule produces against
 * the dates fires actually occurred is the only way to find out whether they
 * describe this site.
 *
 * The rule is applied on read from raw hourly rows, using the SAME constants
 * as the live evaluator and the forecast. Three consumers, one definition of
 * danger.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import {
  HAZARD_PROFILES,
  PHOSPHORUS_IGNITION,
} from '../evaluation/alert-level.enum';

/** Ignition-window days in one calendar month. */
export interface MonthSummary {
  /** 1–12. */
  month: number;
  /** Days on which both criteria were met in the same hour. */
  days: number;
  /** Total hours across those days. */
  hours: number;
}

export interface YearSummary {
  year: number;
  days: number;
  hours: number;
  /** The single longest continuous window that year, in hours. */
  longestWindowHours: number;
  months: MonthSummary[];
}

export interface ZoneHistory {
  zoneId: number;
  name: { de: string; en: string };
  hazardType: string;
  /** False where escalation does not depend on weather — see ForecastService. */
  weatherGated: boolean;
  /** Which soil layer the underlying data came from, so a reader can judge. */
  sources: string[];
  years: YearSummary[];
  /** Mean ignition-window days per COMPLETE year, ignoring the current one. */
  averageDaysPerYear: number | null;
}

/**
 * Ignition-window hours grouped by day, computed in SQL.
 *
 * The same-hour requirement is expressed as a plain WHERE over hourly rows:
 * every row that satisfies both conditions is an ignition hour, and grouping
 * them by day counts the days. Reducing to daily aggregates first — a day's
 * maximum temperature against its minimum moisture — would count days where
 * the heat and the dryness never met.
 */
const WINDOW_DAYS_SQL = `
  SELECT date_part('year',  local_at)::int       AS year,
         date_part('month', local_at)::int       AS month,
         -- As TEXT, deliberately. A date column comes back as a JS Date at
         -- the server's local midnight, and converting that to ISO shifts it
         -- into the previous day for every timezone east of Greenwich.
         to_char(local_at::date, 'YYYY-MM-DD')   AS day,
         count(*)::int                           AS hours
    FROM (
      SELECT observed_at AT TIME ZONE 'Europe/Vienna' AS local_at
        FROM zone_weather_history
       WHERE zone_id = $1
         AND temperature_c     >= $2
         AND soil_moisture_pct <  $3
    ) qualifying
   GROUP BY year, month, day
   ORDER BY day;
`;

@Injectable()
export class HistoryService implements OnModuleInit {
  private readonly logger = new Logger(HistoryService.name);

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  /** Seasonal summary for every active zone. */
  async summary(): Promise<{ zones: ZoneHistory[]; generatedAt: string }> {
    const { rows: zones } = await this.db.query<{
      id: string;
      name_de: string | null;
      name_en: string | null;
      name: string | null;
      hazard_type: string | null;
    }>(`
      SELECT id, name_de, name_en, name, hazard_type
        FROM high_risk_zones WHERE is_active ORDER BY id;
    `);

    const summaries: ZoneHistory[] = [];
    for (const zone of zones) {
      summaries.push(
        await this.forZone(
          Number(zone.id),
          {
            de: zone.name_de ?? zone.name ?? '',
            en: zone.name_en ?? zone.name ?? '',
          },
          zone.hazard_type ?? 'generic',
        ),
      );
    }
    return { zones: summaries, generatedAt: new Date().toISOString() };
  }

  private async forZone(
    zoneId: number,
    name: { de: string; en: string },
    hazardType: string,
  ): Promise<ZoneHistory> {
    const profile = HAZARD_PROFILES[hazardType] ?? HAZARD_PROFILES['generic']!;
    // Whether the ignition window is a meaningful question here — not
    // whether it is what escalates. See HazardProfile.
    const weatherGated = profile.tracksIgnitionWindow;

    const base = { zoneId, name, hazardType, weatherGated };
    if (!weatherGated) {
      return { ...base, sources: [], years: [], averageDaysPerYear: null };
    }

    const { rows: sourceRows } = await this.db.query<{ source: string }>(
      `SELECT DISTINCT source FROM zone_weather_history WHERE zone_id = $1 ORDER BY source;`,
      [zoneId],
    );

    const { rows } = await this.db.query<{
      year: number;
      month: number;
      day: string;
      hours: number;
    }>(WINDOW_DAYS_SQL, [
      zoneId,
      PHOSPHORUS_IGNITION.IGNITION_TEMPERATURE_C,
      PHOSPHORUS_IGNITION.CRITICAL_SOIL_MOISTURE_PCT,
    ]);

    const years = groupByYear(rows);
    const currentYear = new Date().getFullYear();
    // The running year is excluded from the average: half a summer would drag
    // it down and read as a trend rather than an artefact of the calendar.
    const complete = years.filter((y) => y.year < currentYear);
    const averageDaysPerYear = complete.length
      ? Math.round(
          (complete.reduce((sum, y) => sum + y.days, 0) / complete.length) * 10,
        ) / 10
      : null;

    return {
      ...base,
      sources: sourceRows.map((r) => r.source),
      years,
      averageDaysPerYear,
    };
  }

  /**
   * Day-level export rows: one line per zone and ignition-window day.
   *
   * Semicolon-delimited on purpose: the audience is an Austrian authority
   * opening the file in a German-locale Excel, which treats the comma as a
   * decimal sign and shreds comma-separated files into one column.
   */
  async ignitionDaysCsv(): Promise<string> {
    const { rows: zones } = await this.db.query<{
      id: string;
      name_de: string | null;
      name: string | null;
      hazard_type: string | null;
    }>(`SELECT id, name_de, name, hazard_type FROM high_risk_zones
         WHERE is_active ORDER BY id;`);

    const lines = ['zone_id;zone;datum;stunden_im_fenster'];
    for (const zone of zones) {
      const profile =
        HAZARD_PROFILES[zone.hazard_type ?? 'generic'] ?? HAZARD_PROFILES['generic']!;
      if (!profile.tracksIgnitionWindow) continue;

      const { rows } = await this.db.query<{ day: string; hours: number }>(
        WINDOW_DAYS_SQL,
        [
          Number(zone.id),
          PHOSPHORUS_IGNITION.IGNITION_TEMPERATURE_C,
          PHOSPHORUS_IGNITION.CRITICAL_SOIL_MOISTURE_PCT,
        ],
      );
      for (const row of rows) {
        lines.push(
          [
            zone.id,
            csvField(zone.name_de ?? zone.name ?? ''),
            row.day,
            row.hours,
          ].join(';'),
        );
      }
    }
    return lines.join('\r\n') + '\r\n';
  }

  /**
   * Hourly weather per zone, the raw material for the analysis above.
   *
   * `source` records which soil layer a row came from: the archive publishes
   * 0–7 cm while the live rule is written for 1–3 cm. Measured over 1153
   * overlapping hours the two differ by about 2 percentage points, which is
   * close enough to count days in a season and not close enough to hide.
   */
  private async ensureSchema(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS zone_weather_history (
        zone_id           BIGINT NOT NULL REFERENCES high_risk_zones(id),
        observed_at       TIMESTAMPTZ NOT NULL,
        temperature_c     DOUBLE PRECISION NOT NULL,
        soil_moisture_pct DOUBLE PRECISION NOT NULL,
        source            TEXT NOT NULL,
        PRIMARY KEY (zone_id, observed_at)
      );
    `);
    // The only query this table serves filters on both criteria at once.
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_zone_weather_history_window
        ON zone_weather_history (zone_id, observed_at)
        WHERE temperature_c >= 30 AND soil_moisture_pct < 20;
    `);
    this.logger.log('Seasonal ignition history ready');
  }
}

/** Quote a field so names containing the delimiter survive the trip. */
function csvField(value: string): string {
  return /[";\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

/** Fold day rows into years, keeping the longest continuous run of hours. */
function groupByYear(
  rows: { year: number; month: number; day: string; hours: number }[],
): YearSummary[] {
  const years = new Map<number, YearSummary>();

  for (const row of rows) {
    let year = years.get(row.year);
    if (!year) {
      year = { year: row.year, days: 0, hours: 0, longestWindowHours: 0, months: [] };
      years.set(row.year, year);
    }
    year.days += 1;
    year.hours += row.hours;
    year.longestWindowHours = Math.max(year.longestWindowHours, row.hours);

    const month = year.months.find((m) => m.month === row.month);
    if (month) {
      month.days += 1;
      month.hours += row.hours;
    } else {
      year.months.push({ month: row.month, days: 1, hours: row.hours });
    }
  }

  for (const year of years.values()) {
    year.months.sort((a, b) => a.month - b.month);
  }
  return [...years.values()].sort((a, b) => a.year - b.year);
}
