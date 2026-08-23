/**
 * The alert rule, checked at its boundaries.
 *
 * This is the logic that decides whether anybody is woken up. The thresholds
 * are 30 °C and 20 % soil moisture, and what matters is which side of them a
 * tenth of a degree lands on — the kind of thing an end-to-end test through
 * PostGIS and BullMQ can demonstrate once and never at the edges.
 *
 * Direction of failure matters here and is asserted explicitly: understating
 * an active fire is the one way this system must never fail.
 */

import { decide } from './alert-decision';
import { AlertLevel, PHOSPHORUS_IGNITION } from './alert-level.enum';

const IGNITION_C = PHOSPHORUS_IGNITION.IGNITION_TEMPERATURE_C; // 30
const DRY_PCT = PHOSPHORUS_IGNITION.CRITICAL_SOIL_MOISTURE_PCT; // 20

/** Conditions comfortably inside the phosphorus ignition window. */
const IGNITING = { temperatureC: 35, soilMoisturePct: 10 };
/** Conditions comfortably outside it. */
const CALM = { temperatureC: 12, soilMoisturePct: 40 };

describe('decide — outside every hazard zone', () => {
  it('never escalates, however hot and dry it is', () => {
    // A hazard zone is what makes a hot pixel a hazard. A bonfire in a field
    // is not this system's business.
    const verdict = decide({
      hazardType: null,
      confidence: 'h',
      regional: IGNITING,
    });
    expect(verdict.level).toBe(AlertLevel.INFO);
    expect(verdict.withheldBecause).toBeNull();
  });
});

describe('decide — white phosphorus (weather-gated)', () => {
  const phosphorus = (regional: typeof CALM, extra = {}) =>
    decide({
      hazardType: 'white_phosphorus',
      confidence: 'n',
      regional,
      ...extra,
    });

  it('escalates when it is hot enough AND dry enough', () => {
    expect(phosphorus(IGNITING).level).toBe(AlertLevel.CRITICAL_PHOSPHORUS_FIRE);
  });

  it('holds back when only the temperature is reached', () => {
    const verdict = phosphorus({ temperatureC: 35, soilMoisturePct: 40 });
    expect(verdict.level).toBe(AlertLevel.ELEVATED);
    expect(verdict.withheldBecause).toContain('ignition preconditions not met');
  });

  it('holds back when only the soil is dry', () => {
    expect(phosphorus({ temperatureC: 12, soilMoisturePct: 5 }).level).toBe(
      AlertLevel.ELEVATED,
    );
  });

  it('escalates exactly AT the ignition temperature, not one tenth above', () => {
    // The threshold is documented as "reaches ignition", so >= is correct.
    expect(
      phosphorus({ temperatureC: IGNITION_C, soilMoisturePct: 10 }).level,
    ).toBe(AlertLevel.CRITICAL_PHOSPHORUS_FIRE);
    expect(
      phosphorus({ temperatureC: IGNITION_C - 0.1, soilMoisturePct: 10 }).level,
    ).toBe(AlertLevel.ELEVATED);
  });

  it('treats soil moisture AT the threshold as still too wet', () => {
    // Strictly below: 20 % is the moisture at which cracking is assumed to
    // begin, so 20 % itself has not got there.
    expect(
      phosphorus({ temperatureC: 35, soilMoisturePct: DRY_PCT }).level,
    ).toBe(AlertLevel.ELEVATED);
    expect(
      phosphorus({ temperatureC: 35, soilMoisturePct: DRY_PCT - 0.1 }).level,
    ).toBe(AlertLevel.CRITICAL_PHOSPHORUS_FIRE);
  });

  it('ignores a low satellite confidence — the mechanism is buried ordnance', () => {
    // Phosphorus does not require a credible pixel: the zone is known to
    // contain the hazard, and a weak signature is exactly what a small
    // self-ignition looks like.
    expect(
      decide({
        hazardType: 'white_phosphorus',
        confidence: 'l',
        regional: IGNITING,
      }).level,
    ).toBe(AlertLevel.CRITICAL_PHOSPHORUS_FIRE);
  });

  it('says which conditions it decided on, and where they came from', () => {
    const verdict = phosphorus({ temperatureC: 35, soilMoisturePct: 40 });
    expect(verdict.withheldBecause).toContain('35°C');
    expect(verdict.withheldBecause).toContain('40%');
    expect(verdict.withheldBecause).toContain('regional estimate');
  });
});

describe('decide — wildfire (detection-gated)', () => {
  const wildfire = (confidence: string | null, regional = CALM) =>
    decide({ hazardType: 'wildfire', confidence, regional });

  it('escalates on a credible detection regardless of the weather', () => {
    // A satellite hotspot inside a forest already IS a fire. Requiring 30 °C
    // would suppress a real one on a cool day.
    expect(wildfire('h', CALM).level).toBe(AlertLevel.CRITICAL_WILDFIRE);
  });

  it('holds back a pixel the satellite itself rates low', () => {
    const verdict = wildfire('l');
    expect(verdict.level).toBe(AlertLevel.ELEVATED);
    expect(verdict.withheldBecause).toContain('confidence');
  });

  it('treats a missing confidence as credible, never as a downgrade', () => {
    // A missing value must not silently suppress a real detection.
    expect(wildfire(null).level).toBe(AlertLevel.CRITICAL_WILDFIRE);
    expect(wildfire('').level).toBe(AlertLevel.CRITICAL_WILDFIRE);
  });

  it('reads a MODIS percentage as well as a VIIRS letter', () => {
    expect(wildfire('80').level).toBe(AlertLevel.CRITICAL_WILDFIRE);
    expect(wildfire('12').level).toBe(AlertLevel.ELEVATED);
  });
});

describe('decide — ammunition depot', () => {
  it('escalates on heat, unconditionally', () => {
    // Nothing at an ordnance site is allowed to be warm and uninteresting.
    const verdict = decide({
      hazardType: 'ammunition_depot',
      confidence: 'l',
      regional: CALM,
    });
    expect(verdict.level).toBe(AlertLevel.CRITICAL_ORDNANCE_HEAT);
  });
});

describe('decide — an unknown hazard type', () => {
  it('falls back to the conservative generic profile', () => {
    const verdict = decide({
      hazardType: 'chemical_store',
      confidence: 'h',
      regional: CALM,
    });
    expect(verdict.level).toBe(AlertLevel.CRITICAL_THERMAL_ANOMALY);
  });
});

describe('decide — smouldering evidence', () => {
  const evidence = { passes: 3, windowHours: 72, peakFrpMw: 2.4 };

  it('outranks a weather gate that would otherwise hold the alert back', () => {
    // The hazard profiles predict that ignition is LIKELY; persistence
    // observes that something is ALREADY burning.
    const verdict = decide({
      hazardType: 'white_phosphorus',
      confidence: 'n',
      regional: CALM,
      smouldering: evidence,
    });
    expect(verdict.level).toBe(AlertLevel.CRITICAL_SMOULDERING);
  });

  it('outranks a low satellite confidence too', () => {
    expect(
      decide({
        hazardType: 'wildfire',
        confidence: 'l',
        regional: CALM,
        smouldering: evidence,
      }).level,
    ).toBe(AlertLevel.CRITICAL_SMOULDERING);
  });

  it('still does not escalate outside a hazard zone', () => {
    // Requiring a zone is what removes the steady industrial heat sources
    // that look identical to an ember nest from orbit.
    expect(
      decide({
        hazardType: null,
        confidence: 'h',
        regional: IGNITING,
        smouldering: evidence,
      }).level,
    ).toBe(AlertLevel.INFO);
  });
});

describe('decide — ground truth from a local sensor', () => {
  it('prefers the sensor over the regional estimate', () => {
    // The report's weather is one TAWES station standing in for the whole
    // area; the probe is in the wood the rule is about.
    const verdict = decide({
      hazardType: 'white_phosphorus',
      confidence: 'n',
      regional: CALM,
      local: { temperatureC: 34, soilMoisturePct: 8, deviceId: 'eui-1' },
    });
    expect(verdict.level).toBe(AlertLevel.CRITICAL_PHOSPHORUS_FIRE);
    expect(verdict.conditions).toEqual({ temperatureC: 34, soilMoisturePct: 8 });
    expect(verdict.groundSource).toBe('sensor eui-1');
  });

  it('substitutes field by field, so a probe without a soil sensor still helps', () => {
    const verdict = decide({
      hazardType: 'white_phosphorus',
      confidence: 'n',
      regional: { temperatureC: 12, soilMoisturePct: 8 },
      local: { temperatureC: 34, deviceId: 'eui-2' },
    });
    expect(verdict.conditions).toEqual({ temperatureC: 34, soilMoisturePct: 8 });
    expect(verdict.level).toBe(AlertLevel.CRITICAL_PHOSPHORUS_FIRE);
  });

  it('can hold an alert back that the regional estimate would have raised', () => {
    // This is the substitution working in the uncomfortable direction, and it
    // is still correct: the probe measures the soil the rule is about.
    const verdict = decide({
      hazardType: 'white_phosphorus',
      confidence: 'n',
      regional: IGNITING,
      local: { soilMoisturePct: 38, deviceId: 'eui-3' },
    });
    expect(verdict.level).toBe(AlertLevel.ELEVATED);
    expect(verdict.withheldBecause).toContain('sensor eui-3');
  });

  it('reports the numbers the rule actually ran on, never the discarded ones', () => {
    // An alert that displayed the regional figures while deciding on the
    // sensor's would be a lie a responder could not detect.
    const verdict = decide({
      hazardType: 'wildfire',
      confidence: 'h',
      regional: { temperatureC: 12, soilMoisturePct: 40 },
      local: { temperatureC: 31, soilMoisturePct: 9, deviceId: 'eui-4' },
    });
    expect(verdict.conditions).toEqual({ temperatureC: 31, soilMoisturePct: 9 });
  });
});

describe('decide — a forest that is also contaminated', () => {
  const forest = (regional: { temperatureC: number; soilMoisturePct: number }, confidence: string | null) =>
    decide({ hazardType: 'white_phosphorus_forest', confidence, regional });

  it('never alarms less than a plain wildfire zone would', () => {
    // Cool, damp, credible detection: a hotspot under a canopy already IS a
    // fire, and the phosphorus gate must not suppress it.
    expect(forest(CALM, 'h').level).toBe(AlertLevel.CRITICAL_WILDFIRE);
  });

  it('names the phosphorus mechanism once its window is open', () => {
    expect(forest(IGNITING, 'h').level).toBe(AlertLevel.CRITICAL_PHOSPHORUS_FIRE);
  });

  it('stops caring about satellite confidence while the window is open', () => {
    // A self-ignition is small and looks weak from orbit — which is exactly
    // what is expected on ground that holds buried phosphorus.
    expect(forest(IGNITING, 'l').level).toBe(AlertLevel.CRITICAL_PHOSPHORUS_FIRE);
  });

  it('still applies the forest credibility gate with the window closed', () => {
    const verdict = forest(CALM, 'l');
    expect(verdict.level).toBe(AlertLevel.ELEVATED);
    expect(verdict.withheldBecause).toContain('confidence');
  });

  it('needs BOTH conditions for the phosphorus verdict, not either', () => {
    expect(forest({ temperatureC: 35, soilMoisturePct: 40 }, 'h').level).toBe(
      AlertLevel.CRITICAL_WILDFIRE,
    );
    expect(forest({ temperatureC: 12, soilMoisturePct: 5 }, 'h').level).toBe(
      AlertLevel.CRITICAL_WILDFIRE,
    );
  });

  it('is outranked by persistence, like every other profile', () => {
    expect(
      decide({
        hazardType: 'white_phosphorus_forest',
        confidence: 'h',
        regional: IGNITING,
        smouldering: { passes: 3, windowHours: 72, peakFrpMw: 2.4 },
      }).level,
    ).toBe(AlertLevel.CRITICAL_SMOULDERING);
  });
});
