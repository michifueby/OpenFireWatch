-- =============================================================================
-- OpenFireWatch — PostGIS initialization script
--
-- Executed automatically by the official postgis/postgis image on the FIRST
-- startup of an empty data volume (docker-entrypoint-initdb.d).
--
-- Design principles:
--   * The database is the single source of truth for spatial logic.
--   * Deduplication is enforced HERE (unique constraint), not in app code,
--     so re-ingesting the same satellite pass is always an idempotent no-op.
--   * All geometries use SRID 4326 (WGS84), matching FIRMS and GeoJSON.
--
-- SCOPE: this file covers only the tables that exist before the API starts.
-- The hazard-zone tables are owned and self-provisioned by the NestJS layer,
-- because the container entrypoint runs this script ONLY on a fresh volume
-- and schema changes must also reach already-populated databases:
--   * `high_risk_zones`  -> backend/src/risk-zones/risk-zone.service.ts
--   * `validated_events` -> backend/src/evaluation/anomaly-evaluation.service.ts
-- =============================================================================

-- PostGIS is pre-installed in the image; CREATE EXTENSION makes it explicit
-- and keeps this script portable to vanilla PostgreSQL hosts.
CREATE EXTENSION IF NOT EXISTS postgis;

-- -----------------------------------------------------------------------------
-- thermal_anomalies — every detection ingested from satellite sources.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS thermal_anomalies (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Provenance -------------------------------------------------------------
    source          TEXT        NOT NULL,             -- e.g. 'VIIRS_SNPP_NRT'
    satellite       TEXT,                             -- e.g. 'N' (Suomi NPP)

    -- Detection point (WGS84). GEOMETRY (not GEOGRAPHY) keeps ST_Intersects
    -- against the zone polygons index-accelerated and planar-cheap.
    geom            geometry(Point, 4326) NOT NULL,

    -- Measurement ------------------------------------------------------------
    acquired_at     TIMESTAMPTZ NOT NULL,             -- satellite acquisition time (UTC)
    brightness_k    DOUBLE PRECISION,                 -- brightness temperature (Kelvin)
    frp_mw          DOUBLE PRECISION,                 -- Fire Radiative Power (MW)
    confidence      TEXT,                             -- FIRMS: 'l' | 'n' | 'h' or 0–100

    -- Enrichment -------------------------------------------------------------
    -- Ground conditions correlated at ingestion time (temperature, relative
    -- humidity, topsoil moisture) — the inputs to the phosphorus ignition rule.
    weather         JSONB,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Deduplication: one satellite cannot report the same pixel twice for the
    -- same acquisition instant. Workers insert with ON CONFLICT DO NOTHING.
    CONSTRAINT uq_thermal_anomaly_detection
        UNIQUE (source, geom, acquired_at)
);

-- GiST spatial index: the workhorse behind every ST_Intersects zone check
-- and every map-viewport (bounding box) query from the API.
CREATE INDEX IF NOT EXISTS idx_thermal_anomalies_geom
    ON thermal_anomalies USING GIST (geom);

-- Time index: dashboards and retention jobs query by recency.
CREATE INDEX IF NOT EXISTS idx_thermal_anomalies_acquired_at
    ON thermal_anomalies (acquired_at DESC);

-- Note: the demo hazard zone (Föhrenwald) is seeded by RiskZoneService on
-- API startup, so a fresh stack fires alerts out of the box without any
-- manual SQL.
