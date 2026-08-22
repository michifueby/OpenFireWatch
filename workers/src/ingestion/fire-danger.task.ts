/**
 * Fire danger (FWI) per zone: today, the days behind it, the week ahead.
 *
 * Refreshed on the forecast rhythm. For each active zone the task pulls the
 * hourly weather, reduces it to the daily noon observations the system is
 * defined on, runs the FWI chain from the standard starting codes across the
 * 92-day spin-up, and publishes the result two ways:
 *
 *   - a Redis snapshot the API serves (today's class on the panel, the week
 *     in the report), which expires on its own so a stopped worker never
 *     leaves an old danger level looking current;
 *   - one row per zone and PAST day in fire_danger_history, so the seasonal
 *     record and the incident register can later ask what the danger was on
 *     the day something burned. Forecast days are not persisted: they are
 *     expectations, not record.
 */

import { Job } from 'bullmq';
import { Pool } from 'pg';

import { fetchFireWeather } from '../clients/fire-weather.client';
import { listZonePoints } from '../clients/monitoring-area';
import { BUS, config } from '../config';
import {
  FireWeatherIndices,
  computeFireWeatherSeries,
  dailyInputsFromHourly,
} from '../fire-danger/fwi';
import { createRedisConnection } from '../redis';

const redis = createRedisConnection();

/** Four refresh intervals, like the forecast snapshot. */
const SNAPSHOT_TTL_SECONDS = 4 * config.FIRE_DANGER_POLL_INTERVAL;

const pool = new Pool({
  host: config.POSTGRES_HOST,
  port: config.POSTGRES_PORT,
  database: config.POSTGRES_DB,
  user: config.POSTGRES_USER,
  password: config.POSTGRES_PASSWORD,
  max: 2,
});

/** What the API reads. Kept flat and explicit: it is a contract. */
export interface FireDangerSnapshot {
  generatedAt: string;
  /** How the numbers were produced — shown to the reader, never implied. */
  method: 'canadian_fwi';
  zones: Array<{
    zoneId: number;
    name: { de: string; en: string };
    hazardType: string;
    /** Local calendar date the snapshot treats as "today". */
    today: string;
    days: Array<Pick<FireWeatherIndices, 'date' | 'fwi' | 'dangerClass' | 'ffmc' | 'dmc' | 'dc' | 'isi' | 'bui'>>;
  }>;
}

export async function refreshFireDanger(job: Job): Promise<void> {
  const zones = await listZonePoints();
  if (zones.length === 0) {
    await job.log('No active zones — nothing to assess.');
    return;
  }

  const today = localDate(new Date());
  const results: FireDangerSnapshot['zones'] = [];
  let persisted = 0;
  let storeFailures = 0;

  for (const zone of zones) {
    try {
      const hours = await fetchFireWeather(zone.latitude, zone.longitude);
      const series = computeFireWeatherSeries(dailyInputsFromHourly(hours));

      // Only the days a reader can act on travel in the snapshot: yesterday
      // for context, today, and the forecast. The spin-up stays in the
      // history table.
      const fromIndex = Math.max(0, series.findIndex((d) => d.date >= today) - 1);
      results.push({
        zoneId: zone.id,
        name: { de: zone.nameDe, en: zone.nameEn },
        hazardType: zone.hazardType,
        today,
        days: series.slice(fromIndex).map(round),
      });

      try {
        persisted += await store(zone.id, series.filter((d) => d.date <= today));
      } catch (error) {
        // The snapshot is already built; losing the history row must not lose
        // it. The usual cause is the first run after a fresh deploy, before
        // the API has created the table — the next hourly run stores the
        // whole spin-up, so nothing is missed for long.
        storeFailures += 1;
        await job.log(`History for zone ${zone.id} not stored: ${(error as Error).message}`);
      }
    } catch (error) {
      // One zone failing must not cost the others their figure.
      await job.log(`Fire danger for zone ${zone.id} failed: ${(error as Error).message}`);
    }
  }

  if (results.length === 0) {
    throw new Error('No zone fire danger could be computed');
  }

  const snapshot: FireDangerSnapshot = {
    generatedAt: new Date().toISOString(),
    method: 'canadian_fwi',
    zones: results,
  };
  await redis.set(BUS.FIRE_DANGER_KEY, JSON.stringify(snapshot), 'EX', SNAPSHOT_TTL_SECONDS);

  const worst = results
    .map((z) => z.days.find((d) => d.date === today))
    .filter((d): d is NonNullable<typeof d> => !!d)
    .sort((a, b) => b.fwi - a.fwi)[0];
  console.log(
    `[fire-danger] ${results.length}/${zones.length} zone(s), ${persisted} day-row(s) stored` +
      (storeFailures ? ` (${storeFailures} zone(s) not stored — see job log)` : '') +
      (worst ? ` — today up to FWI ${worst.fwi} (${worst.dangerClass})` : ''),
  );
}

/** Upsert: a day is re-scored on every run as its forecast firms into record. */
async function store(zoneId: number, days: FireWeatherIndices[]): Promise<number> {
  if (days.length === 0) return 0;
  const values: unknown[] = [];
  const rows = days.map((d, i) => {
    const b = i * 9;
    values.push(zoneId, d.date, d.fwi, d.dangerClass, d.ffmc, d.dmc, d.dc, d.isi, d.bui);
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`;
  });
  const result = await pool.query(
    `INSERT INTO fire_danger_history
       (zone_id, day, fwi, danger_class, ffmc, dmc, dc, isi, bui)
     VALUES ${rows.join(',')}
     ON CONFLICT (zone_id, day) DO UPDATE
       SET fwi = EXCLUDED.fwi, danger_class = EXCLUDED.danger_class,
           ffmc = EXCLUDED.ffmc, dmc = EXCLUDED.dmc, dc = EXCLUDED.dc,
           isi = EXCLUDED.isi, bui = EXCLUDED.bui, computed_at = now();`,
    values,
  );
  return result.rowCount ?? 0;
}

function round(d: FireWeatherIndices): FireDangerSnapshot['zones'][number]['days'][number] {
  const r1 = (n: number): number => Math.round(n * 10) / 10;
  return {
    date: d.date,
    fwi: r1(d.fwi),
    dangerClass: d.dangerClass,
    ffmc: r1(d.ffmc),
    dmc: r1(d.dmc),
    dc: r1(d.dc),
    isi: r1(d.isi),
    bui: r1(d.bui),
  };
}

/** YYYY-MM-DD in the deployment's local zone (the zone Open-Meteo was asked for). */
function localDate(at: Date): string {
  return at.toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
}

export async function closeFireDanger(): Promise<void> {
  await Promise.allSettled([redis.quit(), pool.end()]);
}
