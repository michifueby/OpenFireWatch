/**
 * Forecast cycle: how the ignition rule is run FORWARDS.
 *
 * The detection pipeline can only report a fire that a satellite has already
 * seen — hours after it started, which the manual names as the system's
 * central weakness. The phosphorus rule, though, is not an observation: it is
 * a statement about conditions. The same source that reports today's topsoil
 * moisture also forecasts it, so the rule can be asked when those conditions
 * will next arrive.
 *
 * One request per active zone, for the point that actually lies inside it.
 * Run hourly rather than every five minutes: a seven-day forecast does not
 * change meaningfully in between, and the courtesy owed to a free service
 * matters more than freshness nobody would notice.
 *
 * This task only FETCHES. Whether a given hour counts as an ignition window
 * is a question about hazard profiles and thresholds, which the API owns —
 * duplicating those numbers here would create a second definition of danger
 * that could quietly disagree with the one raising alerts.
 */

import { Job } from 'bullmq';

import { BUS, config } from '../config';
import { fetchForecast } from '../clients/forecast.client';
import { listZonePoints } from '../clients/monitoring-area';
import { createRedisConnection } from '../redis';

/** Shared handle for publishing the forecast snapshot. */
const forecastRedis = createRedisConnection();

/**
 * Kept for four cycles, like the conditions snapshot: long enough to survive
 * a couple of failed runs, short enough that a stopped worker makes the key
 * disappear instead of leaving a week-old forecast looking current.
 */
const SNAPSHOT_TTL_SECONDS = 4 * 60 * 60;

export async function refreshForecast(job: Job): Promise<void> {
  const zones = await listZonePoints();
  if (zones.length === 0) {
    await job.log('No active zones — nothing to forecast.');
    return;
  }

  const forecasts = [];
  for (const zone of zones) {
    try {
      const hours = await fetchForecast(zone.latitude, zone.longitude);
      forecasts.push({
        zoneId: zone.id,
        name: { de: zone.nameDe, en: zone.nameEn },
        hazardType: zone.hazardType,
        latitude: zone.latitude,
        longitude: zone.longitude,
        hours,
      });
    } catch (error) {
      // One zone's forecast failing must not cost the others theirs.
      await job.log(
        `Forecast for zone ${zone.id} failed: ${(error as Error).message}`,
      );
    }
  }

  if (forecasts.length === 0) {
    throw new Error('No zone forecast could be retrieved');
  }

  await forecastRedis.set(
    BUS.FORECAST_KEY,
    JSON.stringify({ generatedAt: new Date().toISOString(), zones: forecasts }),
    'EX',
    SNAPSHOT_TTL_SECONDS,
  );

  const total = forecasts.reduce((sum, f) => sum + f.hours.length, 0);
  console.log(
    `[forecast] ${forecasts.length}/${zones.length} zone(s), ${total} forecast hours`,
  );
}

/** Release the handle during graceful shutdown. */
export async function closeForecastRedis(): Promise<void> {
  await forecastRedis.quit();
}

/** Re-exported so the scheduler can state its own interval. */
export const FORECAST_INTERVAL_SECONDS = config.FORECAST_POLL_INTERVAL;
