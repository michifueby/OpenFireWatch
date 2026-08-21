/**
 * ForecastService — when does each zone next meet its own ignition criteria?
 *
 * The detection pipeline answers "is something burning?", and can only answer
 * it once a satellite has seen the fire — hours late, as the manual says
 * plainly. This answers a different question, using the same rule read
 * forwards: "when do the conditions for ignition arrive?"
 *
 * The thresholds are imported from the evaluation module rather than restated
 * here. A second copy would be a second definition of danger, free to drift
 * from the one that actually raises alerts — and the drift would be invisible
 * until the day a forecast said "safe" about conditions the live rule
 * considered critical.
 *
 * Only weather-gated hazards can be forecast at all. A wildfire zone escalates
 * on any credible detection, which is not a thing weather can predict; saying
 * "no ignition window" about such a zone would read as reassurance the system
 * cannot give.
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';

import {
  HAZARD_PROFILES,
  PHOSPHORUS_IGNITION,
} from '../evaluation/alert-level.enum';

/** Must match the workers' `BUS.FORECAST_KEY`. */
const FORECAST_KEY = 'forecast:current';

/** One continuous run of hours in which both criteria hold. */
export interface IgnitionWindow {
  /** ISO-8601 local time of the first qualifying hour. */
  from: string;
  /** ISO-8601 local time of the last qualifying hour. */
  to: string;
  /** Hottest hour in the window — the peak of the risk. */
  peakTemperatureC: number;
  /** Driest soil in the window. */
  minSoilMoisturePct: number;
}

export interface ZoneForecast {
  zoneId: number;
  name: { de: string; en: string };
  hazardType: string;
  /**
   * False for zones whose escalation does not depend on weather. Their
   * forecast is not "safe" — it is "not a question weather can answer".
   */
  weatherGated: boolean;
  /** Ignition windows in the next seven days, earliest first. */
  windows: IgnitionWindow[];
  /**
   * Hours until the next window opens, or null if none is forecast.
   * Precomputed because it is what every consumer actually wants.
   */
  hoursUntilNextWindow: number | null;
  /**
   * Whether the soil criterion alone is already met right now. This is the
   * state that turns a hot afternoon into an ignition window, and it moves
   * over days rather than hours — which is exactly what makes it worth
   * showing before anything has happened.
   */
  soilAlreadyDry: boolean;
}

export interface ForecastSnapshot {
  available: boolean;
  generatedAt: string | null;
  zones: ZoneForecast[];
}

/** Shape the workers publish. */
interface RawForecast {
  generatedAt: string;
  zones: {
    zoneId: number;
    name: { de: string; en: string };
    hazardType: string;
    hours: { at: string; temperatureC: number; soilMoisturePct: number }[];
  }[];
}

@Injectable()
export class ForecastService implements OnModuleDestroy {
  private readonly logger = new Logger(ForecastService.name);
  private readonly redis = new IORedis({
    host: process.env.REDIS_HOST ?? 'redis',
    port: Number(process.env.REDIS_PORT ?? 6379),
    db: Number(process.env.REDIS_DB ?? 0),
    retryStrategy: (attempt) => Math.min(2 ** attempt * 100, 30_000),
  });

  /**
   * Release the connection on shutdown.
   *
   * Without this the process keeps a live socket after the application has
   * closed — invisible in production, and immediately fatal in the test
   * suite, where the run simply never ends.
   */
  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit();
  }

  async current(): Promise<ForecastSnapshot> {
    let raw: RawForecast | null = null;
    try {
      const stored = await this.redis.get(FORECAST_KEY);
      raw = stored ? (JSON.parse(stored) as RawForecast) : null;
    } catch (error) {
      this.logger.warn(`Could not read forecast: ${(error as Error).message}`);
    }

    // The key expires on its own, so its absence means the forecast is stale
    // rather than reassuring. Say so instead of returning an empty list, which
    // would read as "no ignition window ahead".
    if (!raw) return { available: false, generatedAt: null, zones: [] };

    return {
      available: true,
      generatedAt: raw.generatedAt,
      zones: raw.zones.map((zone) => this.evaluate(zone)),
    };
  }

  private evaluate(zone: RawForecast['zones'][number]): ZoneForecast {
    const profile = HAZARD_PROFILES[zone.hazardType] ?? HAZARD_PROFILES['generic']!;
    const weatherGated = profile.requiresIgnitionWeather;

    const base = {
      zoneId: zone.zoneId,
      name: zone.name,
      hazardType: zone.hazardType,
      weatherGated,
    };

    if (!weatherGated) {
      return {
        ...base,
        windows: [],
        hoursUntilNextWindow: null,
        soilAlreadyDry: false,
      };
    }

    const windows = findWindows(zone.hours);
    const next = windows[0];

    return {
      ...base,
      windows,
      hoursUntilNextWindow: next
        ? Math.max(0, Math.round((Date.parse(next.from) - Date.now()) / 3_600_000))
        : null,
      soilAlreadyDry:
        (zone.hours[0]?.soilMoisturePct ?? Infinity) <
        PHOSPHORUS_IGNITION.CRITICAL_SOIL_MOISTURE_PCT,
    };
  }
}

/**
 * Group qualifying hours into continuous windows.
 *
 * Both criteria must hold in the SAME hour. Comparing a day's maximum
 * temperature against that day's minimum soil moisture would report windows
 * that never existed — the heat at 15:00 and the dryness at 04:00 are not a
 * coincidence in time, and ignition needs them to be.
 */
function findWindows(
  hours: { at: string; temperatureC: number; soilMoisturePct: number }[],
): IgnitionWindow[] {
  const windows: IgnitionWindow[] = [];
  let open: IgnitionWindow | null = null;

  for (const hour of hours) {
    const qualifies =
      hour.temperatureC >= PHOSPHORUS_IGNITION.IGNITION_TEMPERATURE_C &&
      hour.soilMoisturePct < PHOSPHORUS_IGNITION.CRITICAL_SOIL_MOISTURE_PCT;

    if (!qualifies) {
      if (open) windows.push(open);
      open = null;
      continue;
    }

    if (!open) {
      open = {
        from: hour.at,
        to: hour.at,
        peakTemperatureC: hour.temperatureC,
        minSoilMoisturePct: hour.soilMoisturePct,
      };
      continue;
    }

    open.to = hour.at;
    open.peakTemperatureC = Math.max(open.peakTemperatureC, hour.temperatureC);
    open.minSoilMoisturePct = Math.min(
      open.minSoilMoisturePct,
      hour.soilMoisturePct,
    );
  }

  if (open) windows.push(open);
  return windows;
}
