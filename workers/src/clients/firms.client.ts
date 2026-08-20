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
export async function fetchFirmsDetections(bbox: string): Promise<RawDetection[]> {
  // ".../{key}/{source}/{west,south,east,north}/1" — trailing 1 = last 24h.
  // The bbox is resolved per cycle (see monitoring-area.ts), so a newly added
  // hazard zone widens the polled area without any configuration change.
  const url =
    'https://firms.modaps.eosdis.nasa.gov/api/area/csv/' +
    `${config.FIRMS_MAP_KEY}/${config.FIRMS_SOURCE}/${bbox}/1`;

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
      source: config.FIRMS_SOURCE,
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
