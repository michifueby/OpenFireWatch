/**
 * The weather the FWI system is computed from (Open-Meteo, free, key-less).
 *
 * One request per zone point: hourly temperature, relative humidity, wind and
 * precipitation for the past 92 days plus the seven-day forecast. The past
 * days are not decoration — the three moisture codes have memory (the drought
 * code remembers about two months), so the index for TODAY depends on the
 * weather of the last season. Ninety-two days is enough for the conventional
 * starting values to have washed out entirely, and it is the most the
 * forecast endpoint hands back in one call.
 *
 * Forecast and history come from the same model run here, so there is no
 * seam between "what happened" and "what is expected" in the daily chain.
 */

import { FireWeatherHour } from '../fire-danger/fwi';

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

/** Days of history requested for the spin-up. 92 is Open-Meteo's maximum. */
export const SPIN_UP_DAYS = 92;
/** Forecast horizon; matches the ignition forecast's seven days. */
export const FORECAST_DAYS = 7;

export async function fetchFireWeather(
  latitude: number,
  longitude: number,
): Promise<FireWeatherHour[]> {
  const url =
    `${OPEN_METEO_URL}?latitude=${latitude}&longitude=${longitude}` +
    '&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation' +
    `&past_days=${SPIN_UP_DAYS}&forecast_days=${FORECAST_DAYS}&timezone=Europe%2FVienna`;

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Open-Meteo (fire weather) responded with HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    error?: boolean;
    reason?: string;
    utc_offset_seconds?: number;
    hourly?: {
      time?: string[];
      temperature_2m?: Array<number | null>;
      relative_humidity_2m?: Array<number | null>;
      wind_speed_10m?: Array<number | null>;
      precipitation?: Array<number | null>;
    };
  };
  if (body.error) {
    throw new Error(`Open-Meteo (fire weather): ${body.reason ?? 'unknown error'}`);
  }

  const h = body.hourly;
  if (!h?.time || !h.temperature_2m || !h.relative_humidity_2m || !h.wind_speed_10m || !h.precipitation) {
    throw new Error('Open-Meteo (fire weather) is missing the requested variables');
  }

  // Same lesson as the other clients: an unqualified local timestamp is read
  // in the reader's own zone, which silently shifts everything in a UTC
  // container — and noon is the one hour this system is defined on.
  const offset = formatOffset(body.utc_offset_seconds ?? 0);

  const hours: FireWeatherHour[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const t = h.temperature_2m[i];
    const rh = h.relative_humidity_2m[i];
    const w = h.wind_speed_10m[i];
    const p = h.precipitation[i];
    if (t == null || rh == null || w == null || p == null) continue;
    hours.push({
      at: h.time[i]! + offset,
      temperatureC: t,
      relativeHumidityPct: rh,
      windSpeedKmh: w,
      precipitationMm: p,
    });
  }
  return hours;
}

function formatOffset(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  const total = Math.abs(Math.round(seconds / 60));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${sign}${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
