/**
 * Resolves WHICH area is polled for satellite hotspots.
 *
 * By default the bounding box is DERIVED from the active high-risk zones
 * (`ST_Extent` plus a configurable padding) rather than configured by hand.
 *
 * Why: an alert requires a hotspot to be inside the polled box AND inside a
 * hazard zone. Those were two independent settings, so a box that failed to
 * cover its zones disabled them *silently* — the pipeline looked healthy while
 * being incapable of ever raising an alert. Deriving one from the other makes
 * that state unrepresentable. It also means adding a zone requires no
 * configuration change: the next cycle widens the box on its own.
 *
 * `FIRMS_AREA` remains available as an explicit override for deployments that
 * deliberately watch a wider area than their zones (e.g. to collect context
 * detections around the hazard sites).
 */

import { Pool } from 'pg';

import { config } from '../config';

export interface MonitoringArea {
  /** "west,south,east,north" — the exact string the FIRMS API expects. */
  bbox: string;
  /** Centre of the box, used for the topsoil-moisture lookup. */
  centroid: { latitude: number; longitude: number };
  /** Where the box came from, for logging and diagnostics. */
  origin: 'override' | 'zones';
}

/** Read-only pool; a single small query every FIRMS_POLL_INTERVAL seconds. */
const pool = new Pool({
  host: config.POSTGRES_HOST,
  port: config.POSTGRES_PORT,
  database: config.POSTGRES_DB,
  user: config.POSTGRES_USER,
  password: config.POSTGRES_PASSWORD,
  max: 2,
});

export async function resolveMonitoringArea(): Promise<MonitoringArea> {
  // 1) Explicit override wins, so an operator can always take manual control.
  const override = config.FIRMS_AREA?.trim();
  if (override) {
    return { ...parseBbox(override, 'FIRMS_AREA'), origin: 'override' };
  }

  // 2) Otherwise: the extent of every active zone, padded.
  //    ST_Extent ignores inactive zones, so retiring a zone shrinks the box.
  const { rows } = await pool.query<{
    west: number | null;
    south: number | null;
    east: number | null;
    north: number | null;
  }>(
    `
    SELECT ST_XMin(e) - $1 AS west,
           ST_YMin(e) - $1 AS south,
           ST_XMax(e) + $1 AS east,
           ST_YMax(e) + $1 AS north
    FROM (SELECT ST_Extent(geom) AS e
            FROM high_risk_zones
           WHERE is_active) s;
    `,
    [config.FIRMS_AREA_PADDING_DEG],
  );

  // ST_Extent over zero rows yields NULL in every column.
  const extent = rows[0];
  if (
    !extent ||
    extent.west == null ||
    extent.south == null ||
    extent.east == null ||
    extent.north == null
  ) {
    throw new Error(
      'No active high-risk zones — nothing to monitor. Add a zone to ' +
        'high_risk_zones, or set FIRMS_AREA explicitly to poll a fixed box.',
    );
  }

  // Clamp to valid WGS84 bounds; padding near a pole or the antimeridian
  // could otherwise produce a box FIRMS rejects.
  const west = clamp(extent.west, -180, 180);
  const south = clamp(extent.south, -90, 90);
  const east = clamp(extent.east, -180, 180);
  const north = clamp(extent.north, -90, 90);

  return {
    ...parseBbox(
      [west, south, east, north].map((n) => round4(n)).join(','),
      'derived zone extent',
    ),
    origin: 'zones',
  };
}

/** Validate a "west,south,east,north" string and derive its centre. */
function parseBbox(
  value: string,
  label: string,
): { bbox: string; centroid: { latitude: number; longitude: number } } {
  const parts = value.split(',').map(Number);
  const [west, south, east, north] = parts;
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`${label} is not a valid bounding box: "${value}"`);
  }
  if (west! >= east! || south! >= north!) {
    throw new Error(
      `${label} is degenerate ("${value}") — expected west,south,east,north`,
    );
  }
  return {
    bbox: value,
    centroid: {
      latitude: (south! + north!) / 2,
      longitude: (west! + east!) / 2,
    },
  };
}

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/** A zone and the point that stands for it in a point-based lookup. */
export interface ZonePoint {
  id: number;
  nameDe: string;
  nameEn: string;
  hazardType: string;
  latitude: number;
  longitude: number;
}

/**
 * Every active zone with a representative interior point.
 *
 * `ST_PointOnSurface`, not `ST_Centroid`: the centroid of a concave shape —
 * and the Föhrenwald outline is distinctly concave — can fall outside the
 * polygon entirely. A forecast fetched for a point in the neighbouring field
 * would describe the wrong ground.
 */
export async function listZonePoints(): Promise<ZonePoint[]> {
  const { rows } = await pool.query<{
    id: string;
    name_de: string | null;
    name_en: string | null;
    name: string | null;
    hazard_type: string | null;
    latitude: number;
    longitude: number;
  }>(`
    SELECT id, name_de, name_en, name, hazard_type,
           ST_Y(ST_PointOnSurface(geom)) AS latitude,
           ST_X(ST_PointOnSurface(geom)) AS longitude
      FROM high_risk_zones
     WHERE is_active
     ORDER BY id;
  `);

  return rows.map((row) => ({
    id: Number(row.id),
    nameDe: row.name_de ?? row.name ?? '',
    nameEn: row.name_en ?? row.name ?? '',
    hazardType: row.hazard_type ?? 'generic',
    latitude: row.latitude,
    longitude: row.longitude,
  }));
}

/** Release the pool during graceful shutdown. */
export async function closeMonitoringAreaPool(): Promise<void> {
  await pool.end();
}
