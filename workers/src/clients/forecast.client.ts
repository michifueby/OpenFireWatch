/**
 * Ignition-window forecast (Open-Meteo, free and key-less).
 *
 * The phosphorus rule is predictive by nature: it describes conditions, not
 * an observation. Used only against measurements, it can say nothing until a
 * satellite happens to see a fire that is already burning — hours after
 * ignition, which is the system's own documented weakness.
 *
 * The same source that supplies the current topsoil moisture also forecasts
 * it, at the same 1–3 cm depth, for seven days ahead. So the rule can be run
 * forwards: not "is it burning?" but "when do the conditions for ignition
 * arrive?". That is the difference between reporting a fire and being able to
 * send a patrol on Wednesday afternoon.
 *
 * Deliberately hourly rather than daily: a daily maximum temperature paired
 * with a daily minimum soil moisture could report an ignition window that
 * never existed, because the heat came at 15:00 and the dryness at 04:00. The
 * two conditions have to be met at the SAME hour to mean anything.
 *
 * Times are requested in Europe/Vienna, because a window is something a crew
 * reads off a clock — "Thursday 13:00" means the afternoon, and converting
 * that to UTC for storage only to convert it back for display invites the
 * off-by-one-hour that nobody notices until October. The API returns those
 * local times WITHOUT a zone marker, though, and an unqualified timestamp is
 * parsed in the reader's own zone: in a UTC container that silently shifts
 * every window by the offset. So the offset the API reports alongside is
 * appended here, making each timestamp both readable and unambiguous.
 */

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

/** One forecast hour, in the units the ignition rule uses. */
export interface ForecastHour {
  /** ISO-8601 LOCAL time with its UTC offset, e.g. `2026-08-27T13:00+02:00`. */
  at: string;
  temperatureC: number;
  soilMoisturePct: number;
}

/**
 * Hourly temperature and topsoil moisture for the next `days` days.
 *
 * Hours with either value missing are dropped rather than guessed: a gap in
 * the forecast is not the same as a benign value, and inventing one would put
 * a fabricated hour into a safety decision.
 */
export async function fetchForecast(
  latitude: number,
  longitude: number,
  days = 7,
): Promise<ForecastHour[]> {
  const url =
    `${OPEN_METEO_URL}?latitude=${latitude}&longitude=${longitude}` +
    '&hourly=temperature_2m,soil_moisture_1_to_3cm' +
    `&forecast_days=${days}&timezone=Europe%2FVienna`;

  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new Error(`Open-Meteo forecast responded with HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    utc_offset_seconds?: number;
    hourly?: {
      time?: string[];
      temperature_2m?: Array<number | null>;
      soil_moisture_1_to_3cm?: Array<number | null>;
    };
  };

  const times = body.hourly?.time;
  const temperatures = body.hourly?.temperature_2m;
  const moisture = body.hourly?.soil_moisture_1_to_3cm;
  if (!times || !temperatures || !moisture) {
    throw new Error('Open-Meteo forecast is missing the requested variables');
  }

  const offset = formatOffset(body.utc_offset_seconds ?? 0);
  const hours: ForecastHour[] = [];
  for (let i = 0; i < times.length; i++) {
    const temperature = temperatures[i];
    const fraction = moisture[i];
    if (temperature == null || fraction == null) continue;
    hours.push({
      at: times[i]! + offset,
      temperatureC: temperature,
      // Volumetric fraction (m³/m³) → percent, as the rule expects.
      soilMoisturePct: Math.round(fraction * 1000) / 10,
    });
  }
  return hours;
}

/** Seconds east of UTC as an ISO-8601 designator, e.g. 7200 → "+02:00". */
function formatOffset(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  const total = Math.abs(Math.round(seconds / 60));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${sign}${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
