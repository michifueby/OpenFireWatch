/**
 * Centralized, validated configuration for the worker service.
 *
 * Every value comes from the environment (populated by docker-compose from
 * `.env`). Validation happens once at import time via zod — a misconfigured
 * worker fails fast at startup instead of at 3 a.m. during an incident.
 */

import { z } from 'zod';

import { resolvePollSources } from './firms-sources';

const EnvSchema = z.object({
  // --- Redis (event bus) ----------------------------------------------------
  REDIS_HOST: z.string().default('redis'),
  REDIS_PORT: z.coerce.number().int().default(6379),
  /** Logical Redis DB index — lets test runs isolate from dev queues. */
  REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),

  // --- NASA FIRMS (LANCE near-real-time hotspots) -----------------------------
  /** NASA FIRMS map key — https://firms.modaps.eosdis.nasa.gov/api/map_key/ */
  FIRMS_MAP_KEY: z.string().min(1, 'FIRMS_MAP_KEY is required'),
  /**
   * Satellite products polled every cycle, comma-separated.
   *
   * ALL THREE VIIRS INSTRUMENTS BY DEFAULT, and that is the point. They fly
   * the same orbit about forty minutes apart, so each is a separate look at
   * the ground: on 14 August 2026 over the Föhrenwald, NOAA-20 saw the fire
   * at 10:41, NOAA-21 at 11:25, Suomi NPP at 12:00 and NOAA-20 again at
   * 12:19. A deployment polling only Suomi NPP — which is what this was —
   * learns about that fire 79 minutes after it could have.
   *
   * Each source costs one FIRMS transaction per cycle. The budget is 5000 per
   * ten minutes, so three sources on a five-minute cycle spends 36 an hour.
   */
  FIRMS_SOURCES: z
    .string()
    .default('VIIRS_SNPP_NRT,VIIRS_NOAA20_NRT,VIIRS_NOAA21_NRT'),

  /**
   * Superseded by FIRMS_SOURCES. Still read, and merged in rather than
   * ignored: an operator who deliberately added MODIS keeps it. A deployment
   * that only ever carried the old shipped default gains the other two.
   */
  FIRMS_SOURCE: z.string().optional(),
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
  /**
   * Satellite products the archive backfill asks for, by family. Each family
   * has a near-real-time stream and a standard-processing archive; the
   * backfill picks whichever holds the date. VIIRS (375 m pixels) is what the
   * live cycle uses; MODIS is coarser and only useful before 2012.
   */
  FIRMS_BACKFILL_SOURCES: z.string().default('VIIRS_SNPP,VIIRS_NOAA20'),
  /**
   * Pause between archive requests, in milliseconds. FIRMS allows 5000
   * transactions per 10 minutes per key, shared with the live cycle; 500 ms
   * keeps a backfill well under a quarter of that.
   */
  FIRMS_BACKFILL_PACE_MS: z.coerce.number().int().min(100).default(500),

  // --- PostgreSQL / PostGIS (read-only: zone extent lookup) ------------------
  POSTGRES_HOST: z.string().default('db'),
  POSTGRES_PORT: z.coerce.number().int().default(5432),
  POSTGRES_DB: z.string().default('openfirewatch'),
  POSTGRES_USER: z.string().default('openfirewatch'),
  POSTGRES_PASSWORD: z.string().min(1, 'POSTGRES_PASSWORD is required'),
  /** Polling interval in seconds (FIRMS NRT updates every ~5–10 minutes). */
  FIRMS_POLL_INTERVAL: z.coerce.number().int().min(60).default(300),
  /**
   * How many days back each cycle asks for. Two, not one.
   *
   * Near-real-time does not mean punctual: a pass is usually published within
   * three hours, but a processing backlog can push it past twenty-four — and
   * a one-day window misses such a pass FOREVER, because the next cycle asks
   * about a window it has already left behind. Re-asking yesterday costs
   * nothing: the queue's job ids and the database's unique constraint are
   * both keyed on (source, pixel, acquisition time), so a pass already seen
   * is silently ignored.
   */
  FIRMS_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(5).default(2),
  /**
   * How often the seven-day ignition forecast is refreshed. Hourly by
   * default: the forecast does not change meaningfully in between, and a
   * free service deserves not to be asked every five minutes.
   */
  FORECAST_POLL_INTERVAL: z.coerce.number().int().min(600).default(3600),
  /**
   * How often to look for gaps in the weather history. Daily: a closed year
   * is fetched once and skipped forever after, so this run is almost always
   * a handful of queries that find nothing to do.
   */
  HISTORY_BACKFILL_INTERVAL: z.coerce.number().int().min(3600).default(86400),
  /**
   * How often the fire danger (FWI) is recomputed. Hourly, with the forecast:
   * the index is a daily quantity, but the forecast it is built from updates
   * through the day and a refresh is one request per zone.
   */
  FIRE_DANGER_POLL_INTERVAL: z.coerce.number().int().min(600).default(3600),

  // --- GeoSphere Austria (TAWES station network, 10-minute cadence) -----------
  /**
   * TAWES station whose current TL (air temperature, °C) and RF (relative
   * humidity, %) readings are correlated with every hotspot in the area.
   * 11090 is the station configured for the Föhrenwald deployment.
   */
  GEOSPHERE_STATION_ID: z.string().default('11090'),
});

const parsed = EnvSchema.parse(process.env);

export const FIRMS_POLL_SOURCES = resolvePollSources(
  parsed.FIRMS_SOURCES,
  parsed.FIRMS_SOURCE,
);

export const config = parsed;

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
  /**
   * Long-running operator-triggered jobs — the satellite archive backfill.
   * Its own queue with its own single worker, so a backfill that takes an
   * hour never holds up a live ingestion cycle.
   */
  BACKFILL_QUEUE: 'jobs.backfill',
  /** Dead letter queue: jobs that exhausted all retries land here. */
  DEAD_LETTER_QUEUE: 'dlq.ingestion',
  /** Redis pub/sub channel the NestJS API relays to WebSocket clients. */
  ALERTS_CHANNEL: 'alerts:anomalies',
  /**
   * Latest ground conditions, refreshed every ingestion cycle. A plain key
   * rather than a table: it is a snapshot, not history, and it expires on its
   * own if ingestion stops — so the UI can say "stale" instead of showing
   * yesterday's weather as if it were current.
   */
  CONDITIONS_KEY: 'conditions:current',
  /**
   * Seven-day hourly forecast per zone, refreshed hourly. Like the conditions
   * snapshot it expires on its own, so a stopped worker leaves no week-old
   * forecast looking current.
   */
  FORECAST_KEY: 'forecast:current',
  /**
   * Fire danger (Canadian FWI) per zone — yesterday, today and the week
   * ahead. Expires like the forecast.
   */
  FIRE_DANGER_KEY: 'fire-danger:current',
} as const;
