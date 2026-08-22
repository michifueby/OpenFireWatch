/**
 * The readiness line is the sentence a responder reads first. Two screens
 * depend on it agreeing with itself — the conditions list and the one-line
 * summary on the collapsed phone sheet — which is why it is a function.
 */

import { ZoneReadiness } from './data-access/conditions.service';
import { Translate, isPartiallyMet, readinessText, windFrom } from './readiness';

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
