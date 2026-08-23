/**
 * The one distinction this page exists to make: quiet is not the same as not
 * looking. These rules decide which of the two a reader is shown.
 */

import { classify, overallState } from './system-status';

const NOW = Date.parse('2026-08-23T12:00:00Z');
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe('classify', () => {
  it('calls a recent delivery fresh', () => {
    expect(classify(ago(60), 600, NOW)).toEqual({
      freshness: 'ok',
      at: ago(60),
      ageSeconds: 60,
    });
  });

  it('calls an old delivery stale, and still reports when it was', () => {
    // Stale must keep the timestamp: "we looked, 40 minutes ago" is a usable
    // sentence; "not ok" is not.
    const state = classify(ago(2400), 600, NOW);
    expect(state.freshness).toBe('stale');
    expect(state.ageSeconds).toBe(2400);
    expect(state.at).not.toBeNull();
  });

  it('is exact at its own boundary', () => {
    expect(classify(ago(600), 600, NOW).freshness).toBe('ok');
    expect(classify(ago(601), 600, NOW).freshness).toBe('stale');
  });

  it('separates "never arrived" from "arrived a while ago"', () => {
    // The key expiring means the system is not looking; that is a different
    // message from an old reading, and collapsing them would hide it.
    expect(classify(null, 600, NOW).freshness).toBe('missing');
    expect(classify(undefined, 600, NOW).freshness).toBe('missing');
  });

  it('treats an unparseable timestamp as missing, never as fresh', () => {
    expect(classify('not a date', 600, NOW).freshness).toBe('missing');
  });

  it('never reports a negative age for a clock that runs ahead', () => {
    expect(classify(ago(-30), 600, NOW).ageSeconds).toBe(0);
  });
});

describe('overallState', () => {
  const healthy = {
    cycle: 'ok' as const,
    sources: [{ ok: true }, { ok: true }, { ok: true }],
    weather: 'ok' as const,
    forecast: 'ok' as const,
    fireDanger: 'ok' as const,
    deadLetters: 0,
  };

  it('is ok when every feed delivered within its own window', () => {
    expect(overallState(healthy)).toBe('ok');
  });

  it('is blind when no ingestion cycle has completed', () => {
    expect(overallState({ ...healthy, cycle: 'missing' })).toBe('blind');
  });

  it('is blind when every instrument failed, however healthy the rest', () => {
    // A cycle that reaches nothing is not a quiet sky.
    expect(
      overallState({ ...healthy, sources: [{ ok: false }, { ok: false }] }),
    ).toBe('blind');
  });

  it('is degraded when one instrument out of three stopped answering', () => {
    // This is the case that went unnoticed for weeks: the picture is real,
    // just a third of what it should be.
    expect(
      overallState({ ...healthy, sources: [{ ok: true }, { ok: true }, { ok: false }] }),
    ).toBe('degraded');
  });

  it('is degraded for a stale cycle, forecast or fire danger', () => {
    expect(overallState({ ...healthy, cycle: 'stale' })).toBe('degraded');
    expect(overallState({ ...healthy, forecast: 'stale' })).toBe('degraded');
    expect(overallState({ ...healthy, fireDanger: 'missing' })).toBe('degraded');
  });

  it('is degraded while anything sits in the dead letter queue', () => {
    expect(overallState({ ...healthy, deadLetters: 1 })).toBe('degraded');
  });

  it('does not call an empty source list blind', () => {
    // A deployment whose workers have not published yet: the cycle state
    // already says what is wrong, and "blind" would overstate it.
    expect(overallState({ ...healthy, sources: [] })).toBe('ok');
  });
});
