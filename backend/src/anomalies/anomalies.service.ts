/**
 * Read-side access to the single source of truth (PostGIS).
 *
 * The service returns GeoJSON built BY THE DATABASE (ST_AsGeoJSON /
 * json_build_object): no geometry marshalling in application code, and the
 * response plugs directly into a MapLibre GeoJSON source on the frontend.
 */

import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import { QueryAnomaliesDto } from './query-anomalies.dto';

@Injectable()
export class AnomaliesService {
  constructor(private readonly db: DatabaseService) {}

  /** Recent anomalies as a GeoJSON FeatureCollection, viewport-filtered. */
  async findAsGeoJson(query: QueryAnomaliesDto): Promise<unknown> {
    const hasBbox =
      query.west !== undefined &&
      query.south !== undefined &&
      query.east !== undefined &&
      query.north !== undefined;

    // && (bbox overlap) uses the same GiST index as ST_Intersects and is the
    // idiomatic, index-accelerated viewport filter for point layers.
    const { rows } = await this.db.query(
      `
      SELECT json_build_object(
        'type', 'FeatureCollection',
        -- COALESCE belongs around json_agg, NOT around the object: with zero
        -- rows json_agg returns NULL while the object itself is non-NULL, so
        -- an outer COALESCE never fires and the API emits "features": null —
        -- invalid GeoJSON that breaks the map on an empty deployment.
        'features', COALESCE(
          json_agg(
            json_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(a.geom)::json,
              'properties', json_build_object(
                'id', a.id,
                'source', a.source,
                'acquiredAt', a.acquired_at,
                'brightnessK', a.brightness_k,
                'frpMw', a.frp_mw,
                'confidence', a.confidence
              )
            )
          ),
          '[]'::json
        )
      ) AS geojson
      FROM (
        SELECT *
        FROM thermal_anomalies
        WHERE ($1::boolean IS FALSE
               OR geom && ST_MakeEnvelope($2, $3, $4, $5, 4326))
          AND ($6::timestamptz IS NULL OR acquired_at >= $6)
        ORDER BY acquired_at DESC
        LIMIT $7
      ) a;
      `,
      [
        hasBbox,
        query.west ?? 0,
        query.south ?? 0,
        query.east ?? 0,
        query.north ?? 0,
        query.since ?? null,
        query.limit,
      ],
    );

    // An aggregate always returns one row, but nothing in the type system
    // says so — and a crash here would 500 the read the map is built on.
    // An empty collection is the honest answer to "no rows".
    return rows[0]?.geojson ?? { type: 'FeatureCollection', features: [] };
  }
}
