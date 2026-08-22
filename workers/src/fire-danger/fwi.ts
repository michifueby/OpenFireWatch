/**
 * The Canadian Forest Fire Weather Index (FWI) System — Van Wagner (1987).
 *
 * WHY THIS IS COMPUTED HERE RATHER THAN FETCHED. There is no public endpoint
 * that answers "what is the fire danger at this point today": EFFIS publishes
 * the map, not the number (its WMS is not queryable and returned blank tiles
 * for every date tried); GeoSphere's data hub has no fire-weather product;
 * Open-Meteo offers none. What EFFIS, ZAMG and the Austrian fire-danger maps
 * all publish is THIS index, computed by THIS published method from the same
 * kind of inputs. Running the method ourselves is therefore not a substitute
 * for the official figure — it is the official method, on our weather data.
 * The UI says so: "FWI, berechnet nach EFFIS-Methode", never "amtlich".
 *
 * A pure, deterministic module: numbers in, numbers out, no I/O. That is what
 * lets the reference test pin every equation to Van Wagner's own worked
 * example, and what lets the same code score a day in 2019 for the seasonal
 * record as easily as today.
 *
 * The system is a chain of three moisture codes with memory, each updated
 * once a day from NOON weather and the rain of the 24 h before noon:
 *
 *   FFMC  fine fuel moisture      — litter and needles, responds in hours
 *   DMC   duff moisture           — loosely compacted organic layer, ~2 weeks
 *   DC    drought code            — deep compact organic layer, ~2 months
 *
 * ...and three indices derived from them:
 *
 *   ISI   initial spread index    — FFMC × wind
 *   BUI   buildup index           — DMC × DC, fuel available to burn
 *   FWI   fire weather index      — ISI × BUI, intensity of a spreading fire
 *
 * Equations and constants follow the canonical reference implementation
 * (cffdrs). Month-dependent day-length factors are the standard values for
 * ~46 °N; Austria at 47–48 °N uses the same table, as EFFIS does for Europe.
 */

/** The three moisture codes carried from one day to the next. */
export interface MoistureCodes {
  ffmc: number;
  dmc: number;
  dc: number;
}

/** Noon weather for one day, as the system expects it. */
export interface DailyFireWeather {
  /** Calendar day, YYYY-MM-DD local. */
  date: string;
  /** 1–12; selects the day-length factor. */
  month: number;
  temperatureC: number;
  relativeHumidityPct: number;
  windSpeedKmh: number;
  /** Rain in the 24 h ending at noon, mm. */
  rain24hMm: number;
}

export interface FireWeatherIndices extends MoistureCodes {
  date: string;
  isi: number;
  bui: number;
  fwi: number;
  dangerClass: DangerClass;
}

/**
 * Starting values when there is no history to carry — the ones the system
 * is conventionally initialised with at the start of a fire season. With a
 * spin-up of ~90 days their influence is gone; the drought code, the slowest,
 * has an e-folding time of about 52 days.
 */
export const INITIAL_CODES: MoistureCodes = { ffmc: 85, dmc: 6, dc: 15 };

/** Day-length factor for the DMC, by month (January first). */
const DMC_DAY_LENGTH = [6.5, 7.5, 9.0, 12.8, 13.9, 13.9, 12.4, 10.9, 9.4, 8.0, 7.0, 6.0];
/** Day-length adjustment for the DC, by month. */
const DC_DAY_LENGTH = [-1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5.0, 2.4, 0.4, -1.6, -1.6];

/** Fine Fuel Moisture Code for today from yesterday's and today's noon weather. */
export function fineFuelMoistureCode(
  previous: number,
  temperatureC: number,
  relativeHumidityPct: number,
  windSpeedKmh: number,
  rainMm: number,
): number {
  const rh = Math.min(100, Math.max(0, relativeHumidityPct));
  let mo = (147.2 * (101 - previous)) / (59.5 + previous);

  if (rainMm > 0.5) {
    const rf = rainMm - 0.5;
    const wetting = 42.5 * rf * Math.exp(-100 / (251 - mo)) * (1 - Math.exp(-6.93 / rf));
    mo += mo > 150 ? wetting + 0.0015 * (mo - 150) ** 2 * Math.sqrt(rf) : wetting;
    if (mo > 250) mo = 250;
  }

  // Equilibrium moisture content for drying (ed) and wetting (ew).
  const ed =
    0.942 * rh ** 0.679 +
    11 * Math.exp((rh - 100) / 10) +
    0.18 * (21.1 - temperatureC) * (1 - Math.exp(-0.115 * rh));

  let m: number;
  if (mo > ed) {
    const ko =
      0.424 * (1 - (rh / 100) ** 1.7) +
      0.0694 * Math.sqrt(windSpeedKmh) * (1 - (rh / 100) ** 8);
    const kd = ko * 0.581 * Math.exp(0.0365 * temperatureC);
    m = ed + (mo - ed) * 10 ** -kd;
  } else {
    const ew =
      0.618 * rh ** 0.753 +
      10 * Math.exp((rh - 100) / 10) +
      0.18 * (21.1 - temperatureC) * (1 - Math.exp(-0.115 * rh));
    if (mo < ew) {
      const k1 =
        0.424 * (1 - ((100 - rh) / 100) ** 1.7) +
        0.0694 * Math.sqrt(windSpeedKmh) * (1 - ((100 - rh) / 100) ** 8);
      const kw = k1 * 0.581 * Math.exp(0.0365 * temperatureC);
      m = ew - (ew - mo) * 10 ** -kw;
    } else {
      m = mo;
    }
  }

  const ffmc = (59.5 * (250 - m)) / (147.2 + m);
  return Math.min(101, Math.max(0, ffmc));
}

/** Duff Moisture Code. */
export function duffMoistureCode(
  previous: number,
  temperatureC: number,
  relativeHumidityPct: number,
  rainMm: number,
  month: number,
): number {
  const t = Math.max(temperatureC, -1.1);
  const rh = Math.min(100, Math.max(0, relativeHumidityPct));
  const rk = 1.894 * (t + 1.1) * (100 - rh) * DMC_DAY_LENGTH[month - 1]! * 1e-4;

  let pr = previous;
  if (rainMm > 1.5) {
    const rw = 0.92 * rainMm - 1.27;
    const wmi = 20 + 280 / Math.exp(0.023 * previous);
    const b =
      previous <= 33
        ? 100 / (0.5 + 0.3 * previous)
        : previous <= 65
          ? 14 - 1.3 * Math.log(previous)
          : 6.2 * Math.log(previous) - 17.2;
    const wmr = wmi + (1000 * rw) / (48.77 + b * rw);
    pr = 43.43 * (5.6348 - Math.log(wmr - 20));
  }
  return Math.max(0, pr) + rk;
}

/** Drought Code. */
export function droughtCode(
  previous: number,
  temperatureC: number,
  rainMm: number,
  month: number,
): number {
  const t = Math.max(temperatureC, -2.8);
  const pe = Math.max(0, (0.36 * (t + 2.8) + DC_DAY_LENGTH[month - 1]!) / 2);

  let dr = previous;
  if (rainMm > 2.8) {
    const rw = 0.83 * rainMm - 1.27;
    const smi = 800 * Math.exp(-previous / 400);
    dr = Math.max(0, previous - 400 * Math.log(1 + (3.937 * rw) / smi));
  }
  return Math.max(0, dr + pe);
}

/**
 * Initial Spread Index from today's FFMC and noon wind.
 *
 * The fine-fuel function carries 91.9 here, not the 19.115 printed in the
 * 1987 paper: the two forms differ by the 0.208 scaling and only this one
 * reproduces the published example (ISI 10.85). It is what every reference
 * implementation uses.
 */
export function initialSpreadIndex(ffmc: number, windSpeedKmh: number): number {
  const fm = (147.2 * (101 - ffmc)) / (59.5 + ffmc);
  const ff = 91.9 * Math.exp(-0.1386 * fm) * (1 + fm ** 5.31 / 4.93e7);
  return 0.208 * Math.exp(0.05039 * windSpeedKmh) * ff;
}

/** Buildup Index from DMC and DC. */
export function buildupIndex(dmc: number, dc: number): number {
  if (dmc === 0 && dc === 0) return 0;
  const bui =
    dmc <= 0.4 * dc
      ? (0.8 * dmc * dc) / (dmc + 0.4 * dc)
      : dmc - (1 - (0.8 * dc) / (dmc + 0.4 * dc)) * (0.92 + (0.0114 * dmc) ** 1.7);
  return Math.max(0, bui);
}

/** Fire Weather Index from ISI and BUI. */
export function fireWeatherIndex(isi: number, bui: number): number {
  const bb =
    bui > 80
      ? 0.1 * isi * (1000 / (25 + 108.64 / Math.exp(0.023 * bui)))
      : 0.1 * isi * (0.626 * bui ** 0.809 + 2);
  return bb <= 1 ? bb : Math.exp(2.72 * (0.434 * Math.log(bb)) ** 0.647);
}

/**
 * One day's step: yesterday's codes and today's noon weather → today's codes
 * and indices.
 */
export function stepFireWeather(
  previous: MoistureCodes,
  day: DailyFireWeather,
): FireWeatherIndices {
  const ffmc = fineFuelMoistureCode(
    previous.ffmc,
    day.temperatureC,
    day.relativeHumidityPct,
    day.windSpeedKmh,
    day.rain24hMm,
  );
  const dmc = duffMoistureCode(
    previous.dmc,
    day.temperatureC,
    day.relativeHumidityPct,
    day.rain24hMm,
    day.month,
  );
  const dc = droughtCode(previous.dc, day.temperatureC, day.rain24hMm, day.month);
  const isi = initialSpreadIndex(ffmc, day.windSpeedKmh);
  const bui = buildupIndex(dmc, dc);
  const fwi = fireWeatherIndex(isi, bui);
  return { date: day.date, ffmc, dmc, dc, isi, bui, fwi, dangerClass: classify(fwi) };
}

/** Run the chain over consecutive days, carrying the codes forward. */
export function computeFireWeatherSeries(
  days: readonly DailyFireWeather[],
  start: MoistureCodes = INITIAL_CODES,
): FireWeatherIndices[] {
  const out: FireWeatherIndices[] = [];
  let codes = start;
  for (const day of days) {
    const today = stepFireWeather(codes, day);
    out.push(today);
    codes = today;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Danger classes
// ---------------------------------------------------------------------------

/** The six classes EFFIS maps the FWI onto, lowest first. */
export type DangerClass =
  | 'very_low'
  | 'low'
  | 'moderate'
  | 'high'
  | 'very_high'
  | 'extreme';

/**
 * EFFIS class boundaries for the FWI (lower bound inclusive). These are the
 * thresholds behind the colours on the European fire danger map; a reader who
 * knows that map reads "high" here the same way.
 */
export const DANGER_CLASS_LOWER_BOUNDS: readonly [DangerClass, number][] = [
  ['very_low', 0],
  ['low', 5.2],
  ['moderate', 11.2],
  ['high', 21.3],
  ['very_high', 38.0],
  ['extreme', 50.0],
];

export function classify(fwi: number): DangerClass {
  let result: DangerClass = 'very_low';
  for (const [name, lower] of DANGER_CLASS_LOWER_BOUNDS) {
    if (fwi >= lower) result = name;
  }
  return result;
}

// ---------------------------------------------------------------------------
// From hourly series to daily inputs
// ---------------------------------------------------------------------------

/** One hour of weather, as the forecast and archive clients deliver it. */
export interface FireWeatherHour {
  /** ISO-8601 local time WITH offset, e.g. "2026-08-22T12:00+02:00". */
  at: string;
  temperatureC: number;
  relativeHumidityPct: number;
  windSpeedKmh: number;
  precipitationMm: number;
}

/**
 * Reduce hourly weather to the daily noon observations the system is defined
 * on: temperature, humidity and wind AT 12:00 local, and the rain that fell
 * in the 24 hours ending then.
 *
 * A day without a 12:00 reading is skipped, not interpolated — the codes
 * simply carry to the next day that has one. Inventing a noon would put a
 * fabricated day into an index people read as a warning.
 */
export function dailyInputsFromHourly(hours: readonly FireWeatherHour[]): DailyFireWeather[] {
  const days: DailyFireWeather[] = [];
  for (let i = 0; i < hours.length; i++) {
    const hour = hours[i]!;
    if (hour.at.slice(11, 16) !== '12:00') continue;

    // Rain over the 24 hourly values up to and including this noon. Each
    // Open-Meteo hourly value is the precipitation of the PRECEDING hour, so
    // the 24 entries ending at 12:00 are exactly the 24 h to noon.
    let rain = 0;
    for (let j = Math.max(0, i - 23); j <= i; j++) rain += hours[j]!.precipitationMm;

    days.push({
      date: hour.at.slice(0, 10),
      month: Number(hour.at.slice(5, 7)),
      temperatureC: hour.temperatureC,
      relativeHumidityPct: hour.relativeHumidityPct,
      windSpeedKmh: hour.windSpeedKmh,
      rain24hMm: rain,
    });
  }
  return days;
}
