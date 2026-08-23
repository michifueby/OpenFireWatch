/**
 * The readiness line is the sentence a responder reads first. Two screens
 * depend on it agreeing with itself — the conditions list and the one-line
 * summary on the collapsed phone sheet — which is why it is a function.
 */

import { ZoneReadiness } from './data-access/conditions.service';
import { Translate, isPartiallyMet, isWindowOpen, readinessText, windFrom } from './readiness';

/** Echoes the key and its parameters, so a test asserts on wording choices. */
const t: Translate = (key, params) =>
  params ? `${key}(${JSON.stringify(params)})` : String(key);

const zone = (over: Partial<ZoneReadiness>): ZoneReadiness => ({
  id: 1,
  name: { de: 'Zone', en: 'Zone' },
  hazardType: 'white_phosphorus',
  gate: 'weather',
  armed: false,
  ...over,
});

describe('readinessText', () => {
  it('says weather is irrelevant for a detection-gated zone', () => {
    expect(readinessText(zone({ gate: 'detection' }), t)).toBe(
      'conditionsOnDetection',
    );
  });

  it('says so plainly when the zone is armed', () => {
    expect(readinessText(zone({ armed: true }), t)).toBe('conditionsArmed');
  });

  it('names only the missing condition when the soil is already dry', () => {
    const text = readinessText(
      zone({ temperatureGapC: 5.7, soilMoistureGapPct: -2 }),
      t,
    );
    expect(text).toContain('conditionsGapTempOnly');
    expect(text).toContain('5.7');
  });

  it('names only the missing condition when it is already hot enough', () => {
    const text = readinessText(
      zone({ temperatureGapC: -3, soilMoistureGapPct: 4 }),
      t,
    );
    expect(text).toContain('conditionsGapSoilOnly');
    expect(text).toContain('4');
  });

  it('names both when neither is met', () => {
    const text = readinessText(
      zone({ temperatureGapC: 11.2, soilMoistureGapPct: 7 }),
      t,
    );
    expect(text).toContain('conditionsGap(');
    expect(text).toContain('11.2');
    expect(text).toContain('7');
  });

  it('reports a crossed threshold as 0, never as a negative distance', () => {
    // "-2 °C from ignition" would read as further away, not past it.
    const text = readinessText(
      zone({ temperatureGapC: -2, soilMoistureGapPct: 4 }),
      t,
    );
    expect(text).not.toContain('-2');
  });

  it('says "?" for a gap the backend could not compute', () => {
    expect(readinessText(zone({}), t)).toContain('?');
  });
});

describe('isPartiallyMet', () => {
  it('is false for a detection-gated zone, which has no gaps to meet', () => {
    expect(isPartiallyMet(zone({ gate: 'detection' }))).toBeFalse();
  });

  it('flags a zone with one condition already satisfied', () => {
    expect(isPartiallyMet(zone({ temperatureGapC: 0, soilMoistureGapPct: 5 }))).toBeTrue();
    expect(isPartiallyMet(zone({ temperatureGapC: 5, soilMoistureGapPct: -1 }))).toBeTrue();
  });

  it('does not flag a zone that is nowhere near', () => {
    expect(isPartiallyMet(zone({ temperatureGapC: 8, soilMoistureGapPct: 5 }))).toBeFalse();
  });
});

describe('windFrom', () => {
  it('maps degrees to the compass point the wind comes FROM', () => {
    expect(windFrom(0, t, false)).toContain('N');
    expect(windFrom(90, t, false)).toContain('"E"');
    expect(windFrom(225, t, false)).toContain('SW');
  });

  it('uses the German compass names when asked', () => {
    expect(windFrom(90, t, true)).toContain('"O"');
  });

  it('wraps past 360 and handles a negative bearing', () => {
    expect(windFrom(361, t, false)).toBe(windFrom(1, t, false));
    expect(windFrom(-90, t, false)).toBe(windFrom(270, t, false));
  });

  it('rounds to the nearest of the eight points rather than truncating', () => {
    expect(windFrom(359, t, false)).toContain('"N"');
  });
});

describe('readinessText — a forest that is also contaminated', () => {
  // Escalates on detection (gate) AND tracks the phosphorus window (gaps).
  const both = (over: Partial<ZoneReadiness>) =>
    readinessText(zone({ gate: 'detection', armed: true, ...over }), t);

  it('says both things: what alarms, and how far the window is', () => {
    const text = both({ temperatureGapC: 8.6, soilMoistureGapPct: 4 });
    expect(text).toContain('conditionsDetectionWindowGap');
    expect(text).toContain('8.6');
    expect(text).toContain('4');
  });

  it('says so plainly once the window is open', () => {
    expect(both({ temperatureGapC: -2, soilMoistureGapPct: -5 })).toBe(
      'conditionsDetectionWindowOpen',
    );
  });

  it('names only the missing half when one condition is already met', () => {
    expect(both({ temperatureGapC: 8.6, soilMoistureGapPct: -3 })).toContain(
      'gapTempOnlyShort',
    );
    expect(both({ temperatureGapC: -1, soilMoistureGapPct: 4 })).toContain(
      'gapSoilOnlyShort',
    );
  });

  it('falls back to the plain sentence for a zone with no window at all', () => {
    // A pure wildfire zone: no gaps, so nothing to add.
    expect(both({})).toBe('conditionsOnDetection');
  });

  it('flags a half-met window on a detection-gated zone too', () => {
    // isPartiallyMet used to return false for anything not weather-gated,
    // which would have left this zone grey while the soil was already dry.
    expect(
      isPartiallyMet(zone({ gate: 'detection', temperatureGapC: 8, soilMoistureGapPct: -3 })),
    ).toBeTrue();
  });
});

describe('isWindowOpen — what may colour a row red', () => {
  it('is false for a detection-gated zone with no window, however armed', () => {
    // `armed` is always true for such a zone; colouring on it would leave the
    // row permanently red and teach the eye to ignore red.
    expect(isWindowOpen(zone({ gate: 'detection', armed: true }))).toBeFalse();
  });

  it('is false for a contaminated forest while the window is still closed', () => {
    expect(
      isWindowOpen(zone({ gate: 'detection', armed: true, temperatureGapC: 9.3, soilMoistureGapPct: -9 })),
    ).toBeFalse();
  });

  it('is true once both conditions are met, whichever gate escalates', () => {
    expect(
      isWindowOpen(zone({ gate: 'detection', armed: true, temperatureGapC: -1, soilMoistureGapPct: -3 })),
    ).toBeTrue();
    expect(
      isWindowOpen(zone({ gate: 'weather', armed: true, temperatureGapC: 0, soilMoistureGapPct: -0.1 })),
    ).toBeTrue();
  });
});
