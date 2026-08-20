/**
 * RiskZoneService — owns the `high_risk_zones` table.
 *
 * High-risk zones are operator-defined polygons over former military areas
 * where unexploded white phosphorus ammunition is buried (the archetype is
 * the "Föhrenwald" pine forest south of Wiener Neustadt, Austria — a WWII
 * air-force ordnance depot area with documented phosphorus contamination).
 *
 * On module init the service:
 *   1. ensures the table + GiST spatial index exist (idempotent DDL — a real
 *      deployment would use versioned migrations, but self-provisioning keeps
 *      the scaffold turnkey), and
 *   2. seeds the demo Föhrenwald polygon exactly once (UNIQUE(name) +
 *      ON CONFLICT makes restarts a no-op, refreshing labels only).
 *
 * Display names are stored per language (name_en / name_de) because zone
 * labels are operator data, not UI strings — see LocalizedName below.
 *
 * All geometries are stored as GEOMETRY(Polygon, 4326): SRID 4326 = WGS84,
 * the lon/lat reference system shared by GPS, GeoJSON, and NASA FIRMS — so
 * detections can be intersected against zones with NO reprojection step.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';

import { DatabaseService } from '../database/database.service';

/** Minimal GeoJSON Polygon typing — rings of [longitude, latitude] pairs. */
export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

/**
 * A zone label in every language the UI offers.
 *
 * Zone names are DATA (operator-maintained, per deployment), not UI strings,
 * so they cannot live in the frontend's translation dictionaries. And because
 * one alert is published ONCE on Redis pub/sub and fanned out to every
 * connected client — each of which may have a different language — the server
 * cannot localize ahead of time. The payload therefore carries all languages
 * and the client picks the one it needs.
 */
export interface LocalizedName {
  en: string;
  de: string;
}

/** A high-risk zone row as returned by intersection queries. */
export interface RiskZone {
  id: number;
  name: LocalizedName;
  hazardType: string;
}

/** Stable internal key of the demo zone (never rendered in the UI). */
const FOEHRENWALD_KEY = 'foehrenwald-demo';

/**
 * Outline of the Föhrenwald in the Steinfeld, south-west of Wiener Neustadt.
 *
 * Source: the OpenStreetMap forest multipolygon named "Föhrenwald"
 * (relation 1209953, © OpenStreetMap contributors, ODbL). This is its largest
 * outer ring — the main body of the forest, ~4.2 km² — simplified with
 * ST_SimplifyPreserveTopology at a 0.0004° tolerance (~45 m), which reduces
 * 202 positions to 53 while changing the enclosed area by about 1 %.
 *
 * Coordinates are WGS84 in GeoJSON order, [longitude, latitude], and the ring
 * is closed. This is a demo boundary derived from land cover — NOT an official
 * hazard or contamination map. A real deployment replaces it with the
 * boundary supplied by the responsible authority.
 */
const FOEHRENWALD_POLYGON: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [16.233608, 47.765014], [16.226838, 47.765546],
      [16.226529, 47.766253], [16.225375, 47.766503],
      [16.226492, 47.767311], [16.223857, 47.767257],
      [16.223371, 47.767795], [16.223189, 47.769918],
      [16.222281, 47.768779], [16.217414, 47.770087],
      [16.216964, 47.769664], [16.206918, 47.771308],
      [16.20566, 47.770718], [16.20563, 47.768616],
      [16.200546, 47.75875], [16.193886, 47.751683],
      [16.195556, 47.749761], [16.206081, 47.757191],
      [16.220218, 47.768962], [16.207178, 47.757708],
      [16.196608, 47.750183], [16.20079, 47.749077],
      [16.201776, 47.747876], [16.207903, 47.748805],
      [16.209431, 47.747013], [16.210758, 47.746737],
      [16.211819, 47.747184], [16.210514, 47.749596],
      [16.21222, 47.747034], [16.214061, 47.748444],
      [16.212503, 47.75021], [16.213948, 47.748939],
      [16.214626, 47.749022], [16.215105, 47.751255],
      [16.222938, 47.754178], [16.220729, 47.756379],
      [16.222271, 47.755321], [16.222417, 47.756203],
      [16.223646, 47.757066], [16.221646, 47.758814],
      [16.222479, 47.759911], [16.225244, 47.759748],
      [16.22695, 47.760693], [16.227565, 47.762536],
      [16.231323, 47.762109], [16.23132, 47.763316],
      [16.235564, 47.762847], [16.235477, 47.7643],
      [16.233966, 47.764571], [16.235411, 47.76447],
      [16.235241, 47.765158], [16.227699, 47.766388],
      [16.233608, 47.765014]
    ],
  ],
};

@Injectable()
export class RiskZoneService implements OnModuleInit {
  private readonly logger = new Logger(RiskZoneService.name);

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
    await this.seedDemoZones();
  }

  /** Idempotent DDL: table + GiST index for O(log n) ST_Intersects lookups. */
  private async ensureSchema(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS high_risk_zones (
        id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        -- Stable internal key: never shown to users, used for seed idempotency.
        name         TEXT NOT NULL UNIQUE,
        -- e.g. 'white_phosphorus', 'wildfire', 'ammunition_depot'
        hazard_type  TEXT NOT NULL DEFAULT 'white_phosphorus',
        -- Single Polygon per row, WGS84. Disjoint areas = separate rows.
        geom         GEOMETRY(Polygon, 4326) NOT NULL,
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // The GiST index is what turns "point in any of thousands of polygons?"
    // into an index probe instead of a sequential scan.
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_high_risk_zones_geom
        ON high_risk_zones USING GIST (geom);
    `);

    // Localized display names, added additively so databases created by an
    // earlier release keep working (a real deployment would use a versioned
    // migration; this scaffold self-provisions to stay turnkey).
    await this.db.query(`
      ALTER TABLE high_risk_zones
        ADD COLUMN IF NOT EXISTS name_en TEXT,
        ADD COLUMN IF NOT EXISTS name_de TEXT;
    `);
    // Legacy migration: earlier releases used the English LABEL as the unique
    // key. Rename it to the stable key first, otherwise the seed below would
    // insert a SECOND, overlapping Föhrenwald zone on existing databases.
    await this.db.query(
      `UPDATE high_risk_zones SET name = $1 WHERE name = $2;`,
      // The historic value — deliberately hard-coded: it must keep matching
      // rows created before the key/label split, no matter how the label
      // reads today.
      [FOEHRENWALD_KEY, 'Föhrenwald (demo) — former ordnance area'],
    );

    // Backfill rows that predate the localized columns: fall back to the
    // internal key so no zone can ever render as an empty label.
    await this.db.query(`
      UPDATE high_risk_zones
         SET name_en = COALESCE(name_en, name),
             name_de = COALESCE(name_de, name)
       WHERE name_en IS NULL OR name_de IS NULL;
    `);
  }

  /** Seed the Föhrenwald demo zone (no-op if it already exists). */
  private async seedDemoZones(): Promise<void> {
    try {
      const result = await this.db.query(
        `
        INSERT INTO high_risk_zones (name, name_en, name_de, hazard_type, geom)
        VALUES (
          $1, $2, $3,
          'white_phosphorus',
          -- GeoJSON coordinates are WGS84 by spec; ST_SetSRID makes the
          -- SRID explicit so the geometry matches the column's type modifier.
          ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)
        )
        -- Re-running must not duplicate the zone, but it SHOULD repair labels
        -- on databases seeded before the localized columns existed.
        ON CONFLICT (name) DO UPDATE
          SET name_en = EXCLUDED.name_en,
              name_de = EXCLUDED.name_de
        RETURNING id, (xmax = 0) AS inserted;
        `,
        [
          FOEHRENWALD_KEY,
          'Föhrenwald (Steinfeld) — demo hazard zone',
          'Föhrenwald (Steinfeld) — Demo-Gefahrenzone',
          JSON.stringify(FOEHRENWALD_POLYGON),
        ],
      );

      const seeded = result.rows[0];
      // xmax = 0 distinguishes a fresh INSERT from the ON CONFLICT UPDATE path.
      if (seeded?.inserted) {
        this.logger.log(`Seeded high-risk zone "Föhrenwald" (id=${seeded.id})`);
      } else {
        this.logger.log('High-risk zones already present — labels refreshed');
      }
    } catch (error) {
      // Seeding failure must be LOUD (the evaluation logic is meaningless
      // without zones) but must not crash the API into a restart loop.
      this.logger.error(`Failed to seed high-risk zones: ${(error as Error).message}`);
    }
  }

  /**
   * All active zones as a GeoJSON FeatureCollection, ready for MapLibre.
   *
   * The GeoJSON is assembled BY THE DATABASE (`ST_AsGeoJSON` +
   * `json_build_object`) — the same approach as AnomaliesService. No geometry
   * marshalling in application code, and the response plugs straight into a
   * map source. Labels ship per language, because one response is cached and
   * served to clients that may render in different languages.
   */
  async findAllAsGeoJson(): Promise<unknown> {
    const { rows } = await this.db.query<{ geojson: unknown }>(`
      SELECT json_build_object(
        'type', 'FeatureCollection',
        -- COALESCE wraps json_agg, not the object — see anomalies.service.ts:
        -- with no active zones the aggregate is NULL but the object is not,
        -- so an outer COALESCE would leave "features": null behind.
        'features', COALESCE(
          json_agg(
            json_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(z.geom)::json,
              'properties', json_build_object(
                'id', z.id,
                'hazardType', z.hazard_type,
                'name', json_build_object(
                  'en', COALESCE(z.name_en, z.name),
                  'de', COALESCE(z.name_de, z.name)
                )
              )
            )
          ),
          '[]'::json
        )
      ) AS geojson
      FROM high_risk_zones z
      WHERE z.is_active;
    `);
    return rows[0].geojson;
  }

  /**
   * Create a zone from operator input (UI or API).
   *
   * The human-facing labels are separate from `name`, the stable internal
   * key, which is derived here as a slug. Slugs keep the database readable
   * for operators while renaming a zone stays a pure label change.
   */
  async create(input: {
    nameEn: string;
    nameDe: string;
    hazardType: string;
    geometry: unknown;
  }): Promise<{ id: number }> {
    const key = await this.reserveKey(slugify(input.nameEn));
    try {
      const { rows } = await this.db.query<{ id: string }>(
        `
        INSERT INTO high_risk_zones (name, name_en, name_de, hazard_type, geom)
        VALUES ($1, $2, $3, $4, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326))
        RETURNING id;
        `,
        [key, input.nameEn, input.nameDe, input.hazardType, JSON.stringify(input.geometry)],
      );
      this.logger.log(`Created high-risk zone "${key}" (id=${rows[0]!.id})`);
      return { id: Number(rows[0]!.id) };
    } catch (error) {
      throw this.translateDbError(error);
    }
  }

  /** Replace an existing zone's labels, category and geometry. */
  async update(
    id: number,
    input: { nameEn: string; nameDe: string; hazardType: string; geometry: unknown },
  ): Promise<void> {
    try {
      const { rowCount } = await this.db.query(
        `
        UPDATE high_risk_zones
           SET name_en     = $2,
               name_de     = $3,
               hazard_type = $4,
               geom        = ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)
         WHERE id = $1;
        `,
        [id, input.nameEn, input.nameDe, input.hazardType, JSON.stringify(input.geometry)],
      );
      if (!rowCount) throw new NotFoundException(`No risk zone with id ${id}`);
      this.logger.log(`Updated high-risk zone id=${id}`);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw this.translateDbError(error);
    }
  }

  /**
   * Retire a zone — deactivate, never delete.
   *
   * `validated_events` references zones, so deleting one would destroy the
   * audit trail of every alert it ever raised. Deactivating stops it from
   * escalating immediately (queries filter on `is_active`) and also shrinks
   * the derived monitoring area, while the history stays intact.
   */
  async deactivate(id: number): Promise<void> {
    const { rowCount } = await this.db.query(
      `UPDATE high_risk_zones SET is_active = FALSE WHERE id = $1 AND is_active;`,
      [id],
    );
    if (!rowCount) throw new NotFoundException(`No active risk zone with id ${id}`);
    this.logger.log(`Retired high-risk zone id=${id}`);
  }

  /** Find a free internal key: "foehrenwald", then "foehrenwald-2", ... */
  private async reserveKey(base: string): Promise<string> {
    const { rows } = await this.db.query<{ name: string }>(
      `SELECT name FROM high_risk_zones WHERE name = $1 OR name LIKE $1 || '-%';`,
      [base],
    );
    if (rows.length === 0) return base;
    const taken = new Set(rows.map((r) => r.name));
    for (let n = 2; ; n++) {
      const candidate = `${base}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  /** Turn PostGIS/Postgres errors into actionable HTTP responses. */
  private translateDbError(error: unknown): Error {
    const message = (error as Error).message ?? String(error);
    // Invalid GeoJSON, wrong geometry type for the column, self-intersections…
    if (
      /GeomFromGeoJSON|Geometry type|invalid|SRID/i.test(message) ||
      (error as { code?: string }).code === '22023'
    ) {
      return new BadRequestException(`Rejected geometry: ${message}`);
    }
    if ((error as { code?: string }).code === '23505') {
      return new ConflictException('A zone with this name already exists.');
    }
    this.logger.error(`Zone write failed: ${message}`);
    return error as Error;
  }

  /**
   * All active zones containing the given WGS84 coordinate.
   *
   * ST_Intersects(zone, point) is the canonical PostGIS containment test for
   * point-vs-polygon: it is GiST-index-accelerated and returns true for
   * points on the boundary as well (which, for hazard zones, is exactly the
   * conservative behavior we want). Note ST_MakePoint(lon, lat) — x first!
   */
  async findZonesContaining(longitude: number, latitude: number): Promise<RiskZone[]> {
    const { rows } = await this.db.query<{
      id: number;
      name: string;
      name_en: string | null;
      name_de: string | null;
      hazard_type: string;
    }>(
      `
      SELECT z.id, z.name, z.name_en, z.name_de, z.hazard_type
      FROM high_risk_zones z
      WHERE z.is_active
        AND ST_Intersects(z.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326));
      `,
      [longitude, latitude],
    );

    return rows.map((row) => ({
      // pg returns BIGINT columns as strings — coerce at the boundary so the
      // rest of the app (and the WebSocket payload) sees real numbers.
      id: Number(row.id),
      // Fall back to the internal key so a label is never blank, even if an
      // operator inserted a zone without filling in the localized columns.
      name: {
        en: row.name_en ?? row.name,
        de: row.name_de ?? row.name,
      },
      hazardType: row.hazard_type,
    }));
  }
}

/** ASCII slug for the internal key: "Föhrenwald — Depot" -> "foehrenwald-depot". */
function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip remaining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'zone';
}
