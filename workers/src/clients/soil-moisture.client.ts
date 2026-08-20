/**
 * Topsoil-moisture client (Open-Meteo, free and key-less).
 *
 * Why a second weather source? The GeoSphere TAWES station provides air
 * temperature (TL) and relative humidity (RF) — but the phosphorus ignition
 * rule's oxygen-exposure criterion is about TOPSOIL desiccation, and TAWES
 * does not publish soil moisture. Open-Meteo's `soil_moisture_1_to_3cm`
 * (volumetric fraction, m³/m³) covers exactly that layer, queried once per
 * ingestion cycle at the monitoring-area centroid (the Föhrenwald box spans
 * ~15 km — one soil reading is representative).
 */

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

/** Latest topsoil (1–3 cm) volumetric moisture, converted to percent. */
export async function fetchTopsoilMoisturePct(
  latitude: number,
  longitude: number,
): Promise<number> {
  const url =
    `${OPEN_METEO_URL}?latitude=${latitude}&longitude=${longitude}` +
    '&hourly=soil_moisture_1_to_3cm&past_hours=1&forecast_hours=1';

  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`Open-Meteo API responded with HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    hourly?: { soil_moisture_1_to_3cm?: Array<number | null> };
  };
  const fraction = body.hourly?.soil_moisture_1_to_3cm?.at(-1);
  if (fraction == null) {
    throw new Error('Open-Meteo response is missing soil moisture data');
  }

  // Volumetric fraction (typically 0.0–0.5 m³/m³) → percent for the DTO.
  return Math.round(fraction * 1000) / 10;
}
