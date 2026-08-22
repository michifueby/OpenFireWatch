/**
 * Backfill: fetch the years of weather a seasonal analysis needs.
 *
 * Runs once per zone per missing year and then does nothing, so the archive is
 * asked for each stretch of history exactly once. New zones and each new
 * calendar year are picked up on the next run without configuration.
 *
 * The hourly rows are stored raw. Whether a given hour counts as an ignition
 * window is a question about thresholds, which the API owns — reducing to
 * daily figures here would also destroy the property the rule depends on:
 * temperature and dryness have to coincide in the SAME hour, and a daily
 * maximum paired with a daily minimum cannot express that.
 */

import { Job } from 'bullmq';
import { Pool } from 'pg';

import { config } from '../config';
import { fetchArchive } from '../clients/archive.client';
import { listZonePoints } from '../clients/monitoring-area';

/** How many calendar years back to reach. Ten covers a decade of summers. */
const YEARS_BACK = Number(process.env.HISTORY_YEARS ?? 10);

/** The archive lags real time by a few days; asking for today returns nothing. */
const ARCHIVE_LAG_DAYS = 6;

const pool = new Pool({
  host: config.POSTGRES_HOST,
  port: config.POSTGRES_PORT,
  database: config.POSTGRES_DB,
  user: config.POSTGRES_USER,
  password: config.POSTGRES_PASSWORD,
  max: 2,
});

export async function backfillHistory(job: Job): Promise<void> {
  const zones = await listZonePoints();
  if (zones.length === 0) {
    await job.log('No active zones — nothing to backfill.');
    return;
  }

  const latest = new Date(Date.now() - ARCHIVE_LAG_DAYS * 86_400_000);
  const thisYear = latest.getUTCFullYear();
  let inserted = 0;

  for (const zone of zones) {
    for (let year = thisYear - YEARS_BACK + 1; year <= thisYear; year++) {
      // The current year is re-fetched each run so the season fills in as it
      // goes; closed years are fetched once and never again.
      const complete = await yearIsComplete(zone.id, year);
      if (complete && year < thisYear) continue;

      const from = `${year}-01-01`;
      const to =
        year === thisYear ? latest.toISOString().slice(0, 10) : `${year}-12-31`;

      try {
        const hours = await fetchArchive(zone.latitude, zone.longitude, from, to);
        inserted += await storeWeatherHours(zone.id, hours);
        await job.log(`Zone ${zone.id}, ${year}: ${hours.length} hours`);
      } catch (error) {
        // One zone-year failing must not cost the rest of the backfill.
        await job.log(
          `Zone ${zone.id}, ${year} failed: ${(error as Error).message}`,
        );
      }
    }
  }

  console.log(`[history] backfill complete, ${inserted} new hour(s) stored`);
}

/** Hours of weather a zone holds inside a date range (inclusive, UTC days). */
export async function countWeatherHours(zoneId: number, from: string, to: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM zone_weather_history
      WHERE zone_id = $1 AND observed_at >= $2::date AND observed_at < ($3::date + 1);`,
    [zoneId, from, to],
  );
  return Number(rows[0]?.n ?? 0);
}

/** A year counts as complete once it holds nearly every hour it could. */
async function yearIsComplete(zoneId: number, year: number): Promise<boolean> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM zone_weather_history
      WHERE zone_id = $1 AND date_part('year', observed_at AT TIME ZONE 'Europe/Vienna') = $2;`,
    [zoneId, year],
  );
  // 8760 hours in a common year; allow for gaps in the reanalysis.
  return Number(rows[0]?.n ?? 0) > 8_000;
}

/**
 * Write archive hours for one zone. Exported: the satellite backfill uses it
 * to make sure the weather of the period it replays is on hand before it
 * starts — a detection from 2014 needs the conditions of 2014.
 */
export async function storeWeatherHours(zoneId: number, hours: { at: string; temperatureC: number; soilMoisturePct: number }[]): Promise<number> {
  if (hours.length === 0) return 0;

  // One statement per batch rather than per row: a decade is ~87 000 rows per
  // zone, and a round trip each would take minutes instead of seconds.
  const CHUNK = 2_000;
  let written = 0;

  for (let i = 0; i < hours.length; i += CHUNK) {
    const chunk = hours.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const placeholders = chunk.map((hour, index) => {
      const base = index * 4;
      values.push(zoneId, hour.at, hour.temperatureC, hour.soilMoisturePct);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, 'archive')`;
    });

    const result = await pool.query(
      `INSERT INTO zone_weather_history
         (zone_id, observed_at, temperature_c, soil_moisture_pct, source)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (zone_id, observed_at) DO NOTHING;`,
      values,
    );
    written += result.rowCount ?? 0;
  }
  return written;
}

/** Release the pool during graceful shutdown. */
export async function closeHistoryPool(): Promise<void> {
  await pool.end();
}
