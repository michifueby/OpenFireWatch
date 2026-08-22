/**
 * Planning a satellite archive backfill — pure, so it can be tested without
 * touching FIRMS.
 *
 * Two decisions are made here and nowhere else:
 *
 *   1. How a date range is cut into requests. FIRMS accepts at most five
 *      days per area request, so a summer is ~25 windows per source.
 *   2. Which product serves each window. Every satellite family comes as a
 *      near-real-time stream and a standard-processing archive whose spans
 *      meet at a boundary FIRMS moves — its data_availability listing says
 *      where. A window that straddles the boundary is split, because asking
 *      the wrong stream returns an empty CSV that looks exactly like "no
 *      fires", the failure this whole system is built to avoid.
 */

/** The most days one FIRMS area request may span. FIRMS rejects anything larger. */
export const FIRMS_MAX_DAY_RANGE = 5;

/** One line of FIRMS' data_availability listing: a product and its date span. */
export interface SourceAvailability {
  source: string;
  minDate: string;
  maxDate: string;
}

export interface BackfillRequest {
  /** Exact FIRMS product, e.g. "VIIRS_SNPP_SP". */
  source: string;
  /** First day, YYYY-MM-DD (UTC). */
  startDate: string;
  /** Number of days from startDate, 1–5. */
  dayRange: number;
}

/** Day arithmetic on YYYY-MM-DD without timezone surprises. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * Every request needed to cover [from, to] (inclusive) for the given source
 * families, in chronological order.
 *
 * Families are expanded against the availability listing: "VIIRS_SNPP" means
 * VIIRS_SNPP_SP for the dates that archive holds and VIIRS_SNPP_NRT for the
 * dates the near-real-time stream holds. Dates neither holds are simply not
 * requested — reported by the caller as a coverage gap, never as zero fires.
 */
export function planBackfill(
  from: string,
  to: string,
  families: readonly string[],
  availability: readonly SourceAvailability[],
): BackfillRequest[] {
  if (daysBetween(from, to) < 0) {
    throw new Error(`Backfill range is inverted: ${from} is after ${to}`);
  }

  const requests: BackfillRequest[] = [];
  for (const family of families) {
    const products = availability.filter(
      (a) => a.source === `${family}_SP` || a.source === `${family}_NRT`,
    );
    for (const product of products) {
      // Clip the requested range to what this product holds.
      const start = from > product.minDate ? from : product.minDate;
      const end = to < product.maxDate ? to : product.maxDate;
      if (daysBetween(start, end) < 0) continue;

      let cursor = start;
      while (daysBetween(cursor, end) >= 0) {
        const remaining = daysBetween(cursor, end) + 1;
        const dayRange = Math.min(FIRMS_MAX_DAY_RANGE, remaining);
        requests.push({ source: product.source, startDate: cursor, dayRange });
        cursor = addDays(cursor, dayRange);
      }
    }
  }

  return requests.sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.source.localeCompare(b.source),
  );
}

/**
 * The days in [from, to] that no selected product covers — so a run can say
 * "2012-01-01 to 2012-01-19 not covered" instead of letting an absence of
 * rows pass as an absence of fires.
 */
export function coverageGaps(
  from: string,
  to: string,
  requests: readonly BackfillRequest[],
): Array<{ from: string; to: string }> {
  const covered = new Set<string>();
  for (const r of requests) {
    for (let i = 0; i < r.dayRange; i++) covered.add(addDays(r.startDate, i));
  }

  const gaps: Array<{ from: string; to: string }> = [];
  let open: string | null = null;
  for (let d = from; daysBetween(d, to) >= 0; d = addDays(d, 1)) {
    if (covered.has(d)) {
      if (open) gaps.push({ from: open, to: addDays(d, -1) });
      open = null;
    } else if (!open) {
      open = d;
    }
  }
  if (open) gaps.push({ from: open, to });
  return gaps;
}
