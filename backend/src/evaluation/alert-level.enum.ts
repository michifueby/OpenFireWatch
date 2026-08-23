/**
 * Alert taxonomy and the per-hazard evaluation criteria.
 */

/** Escalation ladder for evaluated thermal anomalies. */
export enum AlertLevel {
  /** Detection outside every high-risk zone — recorded, not broadcast. */
  INFO = 'INFO',
  /** Detection INSIDE a zone, but its escalation criteria were not met. */
  ELEVATED = 'ELEVATED',

  // --- Critical levels, one per hazard mechanism ------------------------------
  /** Buried white phosphorus, exposed by drought-cracked soil, above its
   *  auto-ignition temperature. */
  CRITICAL_PHOSPHORUS_FIRE = 'CRITICAL_PHOSPHORUS_FIRE',
  /** Credible hotspot inside a forest monitored for wildfire. */
  CRITICAL_WILDFIRE = 'CRITICAL_WILDFIRE',
  /** Heat detected at a site holding ammunition or unexploded ordnance. */
  CRITICAL_ORDNANCE_HEAT = 'CRITICAL_ORDNANCE_HEAT',
  /** Credible hotspot inside a zone with no specific hazard model. */
  CRITICAL_THERMAL_ANOMALY = 'CRITICAL_THERMAL_ANOMALY',
  /** A weak heat source that persisted at the same spot across passes —
   *  the satellite signature of a smouldering ember nest. */
  CRITICAL_SMOULDERING = 'CRITICAL_SMOULDERING',
  /**
   * A ground sensor measured the heat itself. Deliberately its own level and
   * deliberately NOT behind any weather gate: the gates are proxies for
   * "could something ignite?", and a probe reading 55 °C in the soil is past
   * the question — like smouldering persistence, measurement beats prediction.
   */
  CRITICAL_SENSOR_HEAT = 'CRITICAL_SENSOR_HEAT',
}

/** True for every CRITICAL_* level — the levels that page a responder. */
export function isCritical(level: AlertLevel): boolean {
  return level.startsWith('CRITICAL_');
}

/**
 * White phosphorus (P4) self-ignition preconditions.
 *
 * The physics: white phosphorus oxidizes violently on contact with air and
 * auto-ignites at roughly 30 °C (86 °F) — well within an ordinary Central
 * European summer. Buried ordnance is normally sealed off by moist soil;
 * the danger window opens when BOTH hold simultaneously:
 *
 *  1. TEMPERATURE — ambient/soil temperature at or above ~30 °C brings the
 *     exposed phosphorus past its auto-ignition point, and
 *  2. OXYGEN EXPOSURE — prolonged drought drops topsoil moisture low enough
 *     (< ~20 % volumetric water content) that the soil dries, shrinks and
 *     CRACKS, opening air channels down to the buried ordnance.
 *
 * Either condition alone is insufficient: hot but moist soil stays sealed;
 * cracked but cool soil stays below the ignition temperature.
 */
export const PHOSPHORUS_IGNITION = {
  /** Auto-ignition threshold for white phosphorus exposed to air (°C). */
  IGNITION_TEMPERATURE_C: 30,
  /** Topsoil volumetric moisture (%) below which drought cracking is assumed. */
  CRITICAL_SOIL_MOISTURE_PCT: 20,
} as const;

/**
 * How a zone escalates, chosen by its `hazard_type`.
 *
 * WHY THIS EXISTS: the weather preconditions above describe ONE specific
 * mechanism — buried phosphorus reaching air. Applying them to every zone was
 * wrong in both directions. A satellite hotspot inside a forest already *is* a
 * fire; requiring 30 °C air temperature would suppress a real wildfire on a
 * cool day, and the soil-moisture test would downgrade one after rain. And at
 * an ammunition site, any heat at all is an emergency regardless of weather.
 *
 * So each hazard type declares its own gate:
 *   - `tracksIgnitionWindow` — whether the phosphorus ignition window is a
 *     meaningful question for this zone AT ALL. Deliberately separate from
 *     the gate below, because a site can carry two hazards at once: the
 *     Föhrenwald is a pine forest AND contaminated with buried white
 *     phosphorus. Tying "which window applies" to "what escalates" forced a
 *     choice between them — and choosing the phosphorus gate for a forest
 *     means a real fire on a cool April day never pages anybody.
 *   - `requiresIgnitionWeather` — the phosphorus mechanism is weather-driven,
 *     so it keeps the temperature/soil thresholds as a hard precondition.
 *   - `requiresCredibleDetection` — everything else escalates on the detection
 *     itself, filtered only by the satellite's own confidence rating so that
 *     known-weak pixels (sun glint, industrial heat) do not page anyone. The
 *     ordnance case deliberately skips even that: a false alarm there is far
 *     cheaper than a missed one.
 *
 * These are engineering defaults, not doctrine. An operator responsible for a
 * site should tune them — that is exactly why they sit in one table.
 */
export interface HazardProfile {
  /** The level raised when this hazard's criteria are met. */
  criticalLevel: AlertLevel;
  /** Escalation additionally requires the phosphorus temperature/soil gate. */
  requiresIgnitionWeather: boolean;
  /**
   * Whether the 30 °C / 20 % ignition window is computed, shown and
   * forecast for this zone. Implied by `requiresIgnitionWeather` — a gate
   * cannot apply a window it does not track — but also true on its own for a
   * zone that escalates on detection and still has phosphorus in the ground.
   */
  tracksIgnitionWindow: boolean;
  /** Escalation additionally requires a non-low satellite confidence rating. */
  requiresCredibleDetection: boolean;
}

export const HAZARD_PROFILES: Record<string, HazardProfile> = {
  white_phosphorus: {
    criticalLevel: AlertLevel.CRITICAL_PHOSPHORUS_FIRE,
    requiresIgnitionWeather: true,
    tracksIgnitionWindow: true,
    requiresCredibleDetection: false,
  },
  /**
   * A forest that is also contaminated — the Föhrenwald, and every other
   * WWII ordnance site that has since grown over.
   *
   * BOTH hazards, each with its own gate, the more specific one first:
   *
   *   window open   → CRITICAL_PHOSPHORUS_FIRE, whatever the satellite's
   *                   confidence. A small self-ignition looks weak from
   *                   orbit, and that is precisely what is expected here.
   *   window closed → the forest rule: a credible detection escalates
   *                   regardless of weather, because a hotspot under a
   *                   canopy already IS a fire.
   *
   * So it never alarms less than a plain wildfire zone would, and it alarms
   * more specifically when the phosphorus mechanism is actually plausible.
   */
  white_phosphorus_forest: {
    criticalLevel: AlertLevel.CRITICAL_WILDFIRE,
    requiresIgnitionWeather: false,
    tracksIgnitionWindow: true,
    requiresCredibleDetection: true,
  },
  wildfire: {
    criticalLevel: AlertLevel.CRITICAL_WILDFIRE,
    requiresIgnitionWeather: false,
    tracksIgnitionWindow: false,
    requiresCredibleDetection: true,
  },
  ammunition_depot: {
    criticalLevel: AlertLevel.CRITICAL_ORDNANCE_HEAT,
    requiresIgnitionWeather: false,
    tracksIgnitionWindow: false,
    requiresCredibleDetection: false,
  },
  generic: {
    criticalLevel: AlertLevel.CRITICAL_THERMAL_ANOMALY,
    requiresIgnitionWeather: false,
    tracksIgnitionWindow: false,
    requiresCredibleDetection: true,
  },
};

/** Fall back to the most conservative profile for an unknown hazard type. */
export function profileFor(hazardType: string): HazardProfile {
  return HAZARD_PROFILES[hazardType] ?? HAZARD_PROFILES['generic']!;
}

/**
 * Whether a detection is credible enough to page a responder.
 *
 * FIRMS reports confidence two ways: VIIRS uses 'l' | 'n' | 'h' (low, nominal,
 * high), MODIS a 0–100 percentage. Only an explicitly LOW rating suppresses
 * escalation — a missing or unparseable value must never silently downgrade a
 * real detection.
 */
export function isCredibleDetection(confidence: string | null | undefined): boolean {
  if (!confidence) return true;
  const value = confidence.trim().toLowerCase();
  if (value === 'l' || value === 'low') return false;
  if (value === 'n' || value === 'h' || value === 'nominal' || value === 'high') {
    return true;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric >= 30 : true;
}

/**
 * Detecting smouldering ember nests ("Glutnester") from orbit.
 *
 * WHAT THIS CAN AND CANNOT DO — read before tuning.
 *
 * A true ember nest burning underground, in root systems or under a closed
 * canopy is INVISIBLE to VIIRS and MODIS: it is too cool (roughly 500–800 K
 * against 1000 K+ for flame), far smaller than a 375 m pixel, and usually
 * screened by soil or foliage. No threshold here changes that. Confirming or
 * ruling one out needs a thermal camera on the ground or on a drone.
 *
 * What IS detectable is its SIGNATURE. A flaming front travels; an ember nest
 * stays put and keeps radiating weakly. So instead of looking at a single
 * detection, this looks at the history we already store: repeated LOW-power
 * detections at the SAME place across SEPARATE satellite passes.
 *
 * That is evidence of ongoing combustion, not a forecast of it — which is why
 * it outranks the weather-based hazard gates: those predict that ignition is
 * likely, this observes that something is already burning.
 *
 * False positives to be aware of: a steady industrial heat source inside a
 * zone would look identical. Requiring the detection to fall inside an
 * operator-drawn hazard zone removes most of them; the rest is why a
 * responder, not the system, makes the call.
 */
export const SMOULDERING = {
  /** Detections this close count as the same nest. VIIRS pixels are 375 m and
   *  geolocation drifts between passes, so a tight radius would split one
   *  nest into separate clusters. */
  RADIUS_METRES: 500,
  /** How far back to look. Re-ignition risk persists for days after a fire. */
  WINDOW_HOURS: 72,
  /** Distinct acquisition times required — one pass is a detection, several
   *  at the same spot are persistence. */
  MIN_PASSES: 2,
  /** Fire radiative power ceiling (MW). Above this it is an active fire, not
   *  a smouldering remnant, and the hazard profile should describe it. */
  MAX_FRP_MW: 5,
} as const;
