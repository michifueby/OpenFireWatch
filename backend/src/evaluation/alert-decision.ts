/**
 * The rule: given a detection, the conditions and what the zone protects,
 * which alert level is this — and if it is not critical, why not.
 *
 * A pure function on purpose. This is the most consequential logic in the
 * system, and until now it lived in the middle of a 190-line method that also
 * validated a queue job, wrote two tables, logged and published to Redis. That
 * made it reachable only through PostGIS, Redis and BullMQ together, which is
 * why the only coverage it had was end-to-end.
 *
 * Here it takes plain values and returns a verdict, so every threshold can be
 * checked at its boundary — one tenth of a degree either side of ignition —
 * in milliseconds and without infrastructure. The I/O around it stays in
 * AnomalyEvaluationService, where it belongs.
 */

import {
  AlertLevel,
  HazardProfile,
  PHOSPHORUS_IGNITION,
  isCredibleDetection,
  profileFor,
} from './alert-level.enum';

/** A temperature and soil moisture reading, whatever their source. */
export interface Conditions {
  temperatureC: number;
  soilMoisturePct: number;
}

/** Evidence that something at this spot has been burning across passes. */
export interface SmoulderingEvidence {
  passes: number;
  windowHours: number;
  peakFrpMw: number;
}

export interface DecisionInput {
  /** Null when the detection fell outside every hazard zone. */
  readonly hazardType: string | null;
  /** As reported by the satellite: 'l' | 'n' | 'h', or a 0–100 percentage. */
  readonly confidence: string | null | undefined;
  /** The regional estimate that came with the detection report. */
  readonly regional: Conditions;
  /**
   * A live sensor standing inside this zone, if there is one and it is fresh.
   * Substituted field by field: a probe without a soil sensor still improves
   * the temperature.
   */
  readonly local?: Partial<Conditions> & { deviceId?: string };
  /** Persistence evidence, when this detection was weak enough to look for it. */
  readonly smouldering?: SmoulderingEvidence | null;
}

export interface Decision {
  readonly level: AlertLevel;
  /**
   * Why it stayed below critical, in the operator's own terms. Null when it
   * did not — an ELEVATED entry with no reason is merely puzzling.
   */
  readonly withheldBecause: string | null;
  /** The conditions the verdict was actually reached on. */
  readonly conditions: Conditions;
  /** Where those conditions came from, for the log and the reason string. */
  readonly groundSource: string;
}

/**
 * Decide. The order of the checks is the order of their authority:
 *
 *   1. Outside every zone, nothing escalates. A hazard zone is what makes a
 *      hot pixel a hazard.
 *   2. Persistence outranks the hazard profiles. They predict that ignition
 *      is LIKELY; repeated weak detections at one spot observe that something
 *      is ALREADY burning.
 *   3. Otherwise the zone's own profile decides which gates apply.
 */
export function decide(input: DecisionInput): Decision {
  // Ground truth beats the regional estimate. The report's weather is one
  // TAWES station and one grid point standing in for the whole monitored
  // area; a live sensor inside THIS zone measures the soil the rule is about.
  const conditions: Conditions = {
    temperatureC: input.local?.temperatureC ?? input.regional.temperatureC,
    soilMoisturePct: input.local?.soilMoisturePct ?? input.regional.soilMoisturePct,
  };
  const groundSource = input.local
    ? `sensor ${input.local.deviceId ?? 'unnamed'}`
    : 'regional estimate';

  if (input.hazardType === null) {
    return {
      level: AlertLevel.INFO,
      withheldBecause: null,
      conditions,
      groundSource,
    };
  }

  if (input.smouldering) {
    return {
      level: AlertLevel.CRITICAL_SMOULDERING,
      withheldBecause: null,
      conditions,
      groundSource,
    };
  }

  const profile: HazardProfile = profileFor(input.hazardType);

  // Phosphorus gate — both conditions must hold SIMULTANEOUSLY. White
  // phosphorus needs the ground dry enough to crack open and warm enough to
  // reach its ignition point; either alone is not the mechanism.
  const weatherOk =
    !profile.requiresIgnitionWeather ||
    (conditions.temperatureC >= PHOSPHORUS_IGNITION.IGNITION_TEMPERATURE_C &&
      conditions.soilMoisturePct < PHOSPHORUS_IGNITION.CRITICAL_SOIL_MOISTURE_PCT);

  // Credibility gate — suppress pixels the satellite itself rates low.
  const credibilityOk =
    !profile.requiresCredibleDetection || isCredibleDetection(input.confidence);

  if (weatherOk && credibilityOk) {
    return {
      level: profile.criticalLevel,
      withheldBecause: null,
      conditions,
      groundSource,
    };
  }

  return {
    level: AlertLevel.ELEVATED,
    // Weather first when both gates fail: it is the one an operator can check
    // against the panel in front of them.
    withheldBecause: !weatherOk
      ? `ignition preconditions not met (${conditions.temperatureC}°C, soil ` +
        `${conditions.soilMoisturePct}% — ${groundSource})`
      : `satellite confidence rated low ("${input.confidence}")`,
    conditions,
    groundSource,
  };
}
