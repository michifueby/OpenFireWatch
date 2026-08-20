/**
 * Frontend alert model — conceptually mirrors the backend's
 * AnomalyAlertPayload (evaluation/anomaly-evaluation.service.ts) and the
 * AlertLevel enum, so both ends of the WebSocket speak the same shape.
 */

/**
 * Escalation ladder — string values match the backend enum exactly.
 *
 * There is one CRITICAL_* level per hazard mechanism, so the label a responder
 * reads states what they are dealing with rather than a generic "critical".
 */
export enum AlertLevel {
  INFO = 'INFO',
  ELEVATED = 'ELEVATED',
  CRITICAL_PHOSPHORUS_FIRE = 'CRITICAL_PHOSPHORUS_FIRE',
  CRITICAL_WILDFIRE = 'CRITICAL_WILDFIRE',
  CRITICAL_ORDNANCE_HEAT = 'CRITICAL_ORDNANCE_HEAT',
  CRITICAL_THERMAL_ANOMALY = 'CRITICAL_THERMAL_ANOMALY',
  CRITICAL_SMOULDERING = 'CRITICAL_SMOULDERING',
}

/** True for every critical level — keeps the check in exactly one place. */
export const isCriticalLevel = (level: AlertLevel): boolean =>
  level.startsWith('CRITICAL_');

/**
 * Zone labels arrive in every supported language: one alert is broadcast to
 * all connected clients at once, so the server cannot localize per client.
 * Mirrors the backend's LocalizedName.
 */
export interface LocalizedName {
  en: string;
  de: string;
}

/** The high-risk zone a detection intersected (null = outside all zones). */
export interface RiskZoneRef {
  id: number;
  name: LocalizedName;
  hazardType: string;
}

/** Ground conditions used by the phosphorus ignition rule. */
export interface AlertWeather {
  /** Ambient temperature in °C (critical at >= 30 °C). */
  temperatureC: number;
  /** Topsoil volumetric moisture in % (critical below 20 %). */
  soilMoisturePct: number;
}

/** One evaluated thermal anomaly as broadcast by the NestJS gateway. */
export interface AnomalyAlert {
  type: 'thermal_anomaly';
  id: number;
  /** WGS84 coordinates (SRID 4326) of the satellite detection. */
  latitude: number;
  longitude: number;
  /** Acquisition timestamp of the satellite pass (ISO-8601 UTC). */
  acquiredAt: string;
  level: AlertLevel;
  zone: RiskZoneRef | null;
  weather: AlertWeather;
  /** Present only on CRITICAL_SMOULDERING — the persistence evidence. */
  smouldering?: {
    passes: number;
    windowHours: number;
    peakFrpMw: number;
  };
}

/**
 * Typed map of every server → client Socket.IO event. Passing this to
 * `io<ServerToClientEvents>` makes `socket.on(...)` fully type-checked:
 * a typo'd event name or a wrong handler signature fails to compile.
 */
export interface ServerToClientEvents {
  /** Every broadcast-worthy evaluation result (ELEVATED and CRITICAL). */
  'anomaly:new': (alert: AnomalyAlert) => void;
  /** Life-safety channel: any CRITICAL_* escalation, whatever the hazard. */
  'alert:critical': (alert: AnomalyAlert) => void;
}
