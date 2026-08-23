/**
 * NASA FIRMS (LANCE) client — near-real-time satellite hotspots as CSV.
 *
 * Memory efficiency: the HTTP body is never buffered as one string. The web
 * stream from fetch() is bridged into Node's stream API and piped through
 * `csv-parse` in streaming mode, so rows are handled one at a time — a large
 * fire complex producing thousands of detections costs constant memory.
 *
 * All failures throw — the calling BullMQ job owns retry/backoff, so a FIRMS
 * outage (LANCE has scheduled maintenance windows) never crashes the worker:
 * the job simply retries with exponential backoff and eventually
 * dead-letters with full context.
 */

import { parse } from 'csv-parse';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import { config } from '../config';
import { FIRMS_MAX_DAY_RANGE, SourceAvailability } from '../ingestion/satellite-backfill.plan';

/** One raw FIRMS detection row, normalized (not yet a validated DTO). */
export interface RawDetection {
  source: string;
  satellite: string | null;
  latitude: number;
  longitude: number;
  acquiredAt: string;
  brightnessK: number | null;
  frpMw: number | null;
  confidence: string | null;
}

/**
 * NASA rate limit: 5000 transactions per 10 minutes PER MAP KEY, shared across
 * every deployment using that key. One cycle costs exactly one transaction
 * regardless of how large FIRMS_AREA is, so widening the area is free — but
 * adding satellite sources, or fanning out per-tile requests, multiplies it.
 * Keep this a single request per cycle.
 */

/**
 * One FIRMS area request: a source, a box, a span of days, optionally a
 * start date for the archive (omitted = the most recent `dayRange` days).
 *
 * The live cycle and the archive backfill share this so they share the CSV
 * header check below — the one safeguard that tells "no fires" apart from
 * "FIRMS answered with an error in plain text".
 */
export async function fetchFirmsArea(
  source: string,
  bbox: string,
  dayRange: number,
  startDate?: string,
): Promise<RawDetection[]> {
  if (dayRange < 1 || dayRange > FIRMS_MAX_DAY_RANGE) {
    throw new Error(`FIRMS day range must be 1–${FIRMS_MAX_DAY_RANGE}, got ${dayRange}`);
  }
  const url =
    'https://firms.modaps.eosdis.nasa.gov/api/area/csv/' +
    `${config.FIRMS_MAP_KEY}/${source}/${bbox}/${dayRange}` +
    (startDate ? `/${startDate}` : '');

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    // FIRMS explains itself in a short plain-text body (verified: an invalid
    // key yields HTTP 400 with "Invalid MAP_KEY."). Surfacing that text makes
    // the dead-letter entry self-explanatory instead of a bare status code.
    const detail = (await response.text().catch(() => '')).trim().slice(0, 160);
    throw new Error(
      `NASA FIRMS API responded with HTTP ${response.status}` +
        (detail ? `: ${detail}` : '') +
        ' — check FIRMS_MAP_KEY in your .env',
    );
  }
  if (!response.body) {
    throw new Error('NASA FIRMS API returned an empty body');
  }

  // Bridge the fetch web-stream into Node streams and parse row-by-row.
  const parser = Readable.fromWeb(response.body as WebReadableStream).pipe(
    parse({
      // Validate the header instead of trusting it blindly.
      //
      // FIRMS signals some failures — an invalid map key, an exceeded
      // transaction limit — with HTTP 200 and a PLAIN-TEXT message where the
      // CSV should be. With `columns: true` that message would silently
      // become the header row, yielding zero detections: indistinguishable
      // from "no fires in the area". For an early warning system that is the
      // most dangerous failure mode there is, so we fail loudly instead.
      columns: (header: string[]) => {
        if (!header.includes('latitude') || !header.includes('longitude')) {
          throw new Error(
            'NASA FIRMS did not return hotspot CSV. Response began with: ' +
              `"${header.join(',').slice(0, 160)}" — this usually means an ` +
              'invalid FIRMS_MAP_KEY or an exceeded transaction limit.',
          );
        }
        return header;
      },
      skip_empty_lines: true,
      trim: true,
    }),
  );

  const detections: RawDetection[] = [];
  for await (const row of parser as AsyncIterable<Record<string, string>>) {
    const latitude = Number(row['latitude']);
    const longitude = Number(row['longitude']);
    // Skip malformed rows instead of failing the whole batch.
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    detections.push({
      source,
      satellite: row['satellite'] || null,
      latitude,
      longitude,
      // FIRMS splits acquisition into a date and a zero-padded HHMM time.
      acquiredAt: toIsoTimestamp(row['acq_date'], row['acq_time']),
      // VIIRS reports bright_ti4; MODIS reports brightness.
      brightnessK: toNumberOrNull(row['bright_ti4'] ?? row['brightness']),
      frpMw: toNumberOrNull(row['frp']),
      confidence: row['confidence'] || null,
    });
  }

  return detections;
}

function toIsoTimestamp(date: string | undefined, hhmm: string | undefined): string {
  const time = (hhmm ?? '0').padStart(4, '0');
  return `${date}T${time.slice(0, 2)}:${time.slice(2)}:00Z`;
}

function toNumberOrNull(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}


/**
 * Which dates each FIRMS source covers, from FIRMS itself.
 *
 * The archive is split by processing stream: near-real-time (`*_NRT`) for the
 * last few months, standard processing (`*_SP`) for everything older, and the
 * boundary between them moves. Asking rather than assuming is what keeps a
 * backfill from requesting a date a source does not hold and reading the
 * empty answer as "no fires that week".
 */
export async function fetchFirmsAvailability(): Promise<SourceAvailability[]> {
  const url =
    'https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv/' +
    `${config.FIRMS_MAP_KEY}/ALL`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`NASA FIRMS data_availability responded with HTTP ${response.status}`);
  }
  const text = await response.text();
  const lines = text.trim().split('\n');
  if (!lines[0]?.startsWith('data_id,min_date,max_date')) {
    throw new Error(`NASA FIRMS data_availability returned: "${text.slice(0, 120)}"`);
  }
  return lines.slice(1).map((line) => {
    const [source, minDate, maxDate] = line.split(',');
    return { source: source!, minDate: minDate!, maxDate: maxDate! };
  });
}
