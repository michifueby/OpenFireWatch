/**
 * How fresh is fresh enough — the pure half of the status page.
 *
 * Split out so it can be tested at its boundaries: the whole point of this
 * page is to distinguish "quiet" from "not looking", and a rule that decides
 * which of the two a reader is shown deserves more than a glance.
 */

/** What a reader needs to know about one feed, in one word. */
export type Freshness = 'ok' | 'stale' | 'missing';

export interface FeedState {
  freshness: Freshness;
  /** When it last produced something, ISO-8601, or null if never. */
  at: string | null;
  /** How long ago, in seconds. Null when there is nothing to measure from. */
  ageSeconds: number | null;
}

/**
 * Classify a feed by how long ago it last delivered.
 *
 * `missing` and `stale` are deliberately different words. Missing means
 * nothing has ever arrived, or the key that carried it has expired — the
 * system is not looking. Stale means it looked, a while ago, and the reader
 * should weigh the numbers accordingly. Collapsing the two into "not ok"
 * would hide exactly the distinction an operator needs at 03:00.
 */
export function classify(
  at: string | null | undefined,
  staleAfterSeconds: number,
  now: number = Date.now(),
): FeedState {
  if (!at) return { freshness: 'missing', at: null, ageSeconds: null };

  const timestamp = Date.parse(at);
  if (Number.isNaN(timestamp)) {
    return { freshness: 'missing', at: null, ageSeconds: null };
  }

  const ageSeconds = Math.max(0, Math.round((now - timestamp) / 1000));
  return {
    freshness: ageSeconds <= staleAfterSeconds ? 'ok' : 'stale',
    at,
    ageSeconds,
  };
}

/**
 * The single word at the top of the page.
 *
 * Ranked by what it costs to be wrong about:
 *
 *   blind     nothing is arriving from the sky at all — every satellite
 *             source failing, or no ingestion cycle in a long time. The map
 *             is a photograph, not a live picture, and saying anything
 *             milder would let somebody go on trusting it.
 *   degraded  something is not working: an instrument that stopped
 *             answering, a stale forecast, jobs in the dead letter queue.
 *             The picture is still real, just narrower than it should be.
 *   ok        every feed delivered within its own window.
 */
export type Overall = 'ok' | 'degraded' | 'blind';

export function overallState(input: {
  cycle: Freshness;
  sources: readonly { ok: boolean }[];
  weather: Freshness;
  forecast: Freshness;
  fireDanger: Freshness;
  deadLetters: number;
}): Overall {
  const working = input.sources.filter((s) => s.ok).length;

  // No cycle at all, or a cycle that reaches nothing: both mean the sky is
  // no longer being watched.
  if (input.cycle === 'missing') return 'blind';
  if (input.sources.length > 0 && working === 0) return 'blind';

  const degraded =
    input.cycle === 'stale' ||
    working < input.sources.length ||
    input.weather !== 'ok' ||
    input.forecast !== 'ok' ||
    input.fireDanger !== 'ok' ||
    input.deadLetters > 0;

  return degraded ? 'degraded' : 'ok';
}
