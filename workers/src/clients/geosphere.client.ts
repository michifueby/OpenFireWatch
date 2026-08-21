/**
 * GeoSphere Austria client — current conditions from the TAWES station
 * network (10-minute cadence, no API key required).
 *
 * Endpoint: /v1/station/current/tawes-v1-10min?parameters=TL,RF&station_ids=…
 * Response (GeoJSON FeatureCollection, verified against the live API):
 *   {
 *     "timestamps": ["2026-08-19T22:20+00:00"],
 *     "features": [{
 *       "properties": {
 *         "parameters": {
 *           "TL": { "name": "Lufttemperatur",   "unit": "°C", "data": [22.6] },
 *           "RF": { "name": "Relative Feuchte", "unit": "%",  "data": [60.0] }
 *         },
 *         "station": "11090"
 *       }
 *     }]
 *   }
 *
 * All failures throw with a descriptive message — the calling BullMQ job
 * owns the retry/backoff policy, so this client never swallows errors.
 */

const GEOSPHERE_BASE_URL =
  'https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min';

/**
 * One station reading. TL = air temperature (°C), RF = relative humidity (%),
 * FF = wind speed (m/s at source, converted to km/h here), DD = direction the
 * wind comes FROM (degrees). Wind is nullable: not every station reports it,
 * and a missing anemometer must not take temperature down with it.
 */
export interface StationWeather {
  temperatureC: number;
  relativeHumidityPct: number;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  observedAt: string;
  stationId: string;
}

/** Minimal typing of the GeoSphere response — only the fields we consume. */
interface GeoSphereResponse {
  timestamps?: string[];
  features?: Array<{
    properties?: {
      station?: string;
      parameters?: Record<string, { data?: Array<number | null> }>;
    };
  }>;
}

export async function fetchStationWeather(stationId: string): Promise<StationWeather> {
  const url = `${GEOSPHERE_BASE_URL}?parameters=TL,RF,FF,DD&station_ids=${encodeURIComponent(stationId)}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`GeoSphere API responded with HTTP ${response.status}`);
  }

  const body = (await response.json()) as GeoSphereResponse;
  const parameters = body.features?.[0]?.properties?.parameters;
  // `.at(-1)` = the most recent value if multiple timestamps are returned.
  const temperatureC = parameters?.['TL']?.data?.at(-1);
  const relativeHumidityPct = parameters?.['RF']?.data?.at(-1);
  const windMs = parameters?.['FF']?.data?.at(-1);
  const windDirectionDeg = parameters?.['DD']?.data?.at(-1);
  const observedAt = body.timestamps?.at(-1);

  // Stations can report null during sensor maintenance — treat as an outage
  // (throw → retry later) rather than correlating hotspots with garbage.
  if (
    temperatureC == null ||
    relativeHumidityPct == null ||
    observedAt == null
  ) {
    throw new Error(
      `GeoSphere station ${stationId} returned incomplete TL/RF data`,
    );
  }

  return {
    temperatureC,
    relativeHumidityPct,
    // Verified against the live API: FF arrives in m/s. The UI and the DTO
    // speak km/h, so the conversion happens once, here at the boundary.
    windSpeedKmh: windMs == null ? null : Math.round(windMs * 3.6 * 10) / 10,
    windDirectionDeg: windDirectionDeg ?? null,
    observedAt: new Date(observedAt).toISOString(),
    stationId,
  };
}
