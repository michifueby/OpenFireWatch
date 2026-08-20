/**
 * Centralized, validated configuration for the worker service.
 *
 * Every value comes from the environment (populated by docker-compose from
 * `.env`). Validation happens once at import time via zod — a misconfigured
 * worker fails fast at startup instead of at 3 a.m. during an incident.
 */

import { z } from 'zod';

const EnvSchema = z.object({
  // --- Redis (event bus) ----------------------------------------------------
  REDIS_HOST: z.string().default('redis'),
  REDIS_PORT: z.coerce.number().int().default(6379),
  /** Logical Redis DB index — lets test runs isolate from dev queues. */
  REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),

  // --- NASA FIRMS (LANCE near-real-time hotspots) -----------------------------
  /** NASA FIRMS map key — https://firms.modaps.eosdis.nasa.gov/api/map_key/ */
  FIRMS_MAP_KEY: z.string().min(1, 'FIRMS_MAP_KEY is required'),
  /** Satellite source: VIIRS_SNPP_NRT | VIIRS_NOAA20_NRT | MODIS_NRT */
  FIRMS_SOURCE: z.string().default('VIIRS_SNPP_NRT'),
  /**
   * OPTIONAL override of the monitored bounding box ("west,south,east,north",
   * WGS84). Leave it EMPTY — the default — and the box is derived from the
   * active high-risk zones on every cycle instead.
   *
   * Deriving it makes the system's core invariant unbreakable: a hotspot must
   * lie inside the box to be ingested, and inside a zone to raise an alert, so
   * a box that does not cover its zones silently disables them. Computing one
   * from the other removes that failure mode entirely — and means adding a
   * zone needs no configuration change at all.
   */
  FIRMS_AREA: z.string().optional(),

  /** Padding added around the zone extent, in degrees (~0.05° ≈ 5.5 km). */
  FIRMS_AREA_PADDING_DEG: z.coerce.number().min(0).max(5).default(0.05),

  // --- PostgreSQL / PostGIS (read-only: zone extent lookup) ------------------
  POSTGRES_HOST: z.string().default('db'),
  POSTGRES_PORT: z.coerce.number().int().default(5432),
  POSTGRES_DB: z.string().default('openfirewatch'),
  POSTGRES_USER: z.string().default('openfirewatch'),
  POSTGRES_PASSWORD: z.string().min(1, 'POSTGRES_PASSWORD is required'),
  /** Polling interval in seconds (FIRMS NRT updates every ~5–10 minutes). */
  FIRMS_POLL_INTERVAL: z.coerce.number().int().min(60).default(300),

  // --- GeoSphere Austria (TAWES station network, 10-minute cadence) -----------
  /**
   * TAWES station whose current TL (air temperature, °C) and RF (relative
   * humidity, %) readings are correlated with every hotspot in the area.
   * 11090 is the station configured for the Föhrenwald deployment.
   */
  GEOSPHERE_STATION_ID: z.string().default('11090'),
});

export const config = EnvSchema.parse(process.env);

/**
 * Well-known event-bus names, shared by producers and consumers.
 * Keeping them in one place prevents "stringly-typed" drift between services.
 *
 * NOTE: BullMQ queue names must NOT contain ":" (it is Redis' key namespace
 * separator, which BullMQ uses internally) — hence the dot separators.
 * Plain pub/sub channel names have no such restriction.
 */
export const BUS = {
  /**
   * Durable BullMQ queue carrying VALIDATED detection reports (satellite
   * detection + correlated weather). Consumed by the NestJS
   * AnomalyEvaluationService, which applies the phosphorus ignition rule.
   */
  DETECTION_REPORTS_QUEUE: 'events.detection-reports',
  /** Durable BullMQ queue that schedules the recurring ingestion cycles. */
  INGESTION_QUEUE: 'jobs.ingestion',
  /** Dead letter queue: jobs that exhausted all retries land here. */
  DEAD_LETTER_QUEUE: 'dlq.ingestion',
  /** Redis pub/sub channel the NestJS API relays to WebSocket clients. */
  ALERTS_CHANNEL: 'alerts:anomalies',
} as const;
