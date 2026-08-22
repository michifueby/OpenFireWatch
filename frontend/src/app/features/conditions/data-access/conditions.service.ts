/**
 * ConditionsService — the current ground conditions.
 *
 * Refreshed on a timer rather than pushed: conditions change on the ingestion
 * cadence (minutes), so a WebSocket channel would add machinery for data that
 * is never urgent. Alerts are the urgent part, and those already stream.
 *
 * The timer itself is `polledResource` — shared with the forecast, because
 * three hand-written copies of the same interval are three chances to leak
 * one.
 */

import { Injectable, Signal } from '@angular/core';

import { polledResource } from '@core/api/polled-resource';

/** How close one zone is to escalating, mirroring the backend's ZoneReadiness. */
export interface ZoneReadiness {
  id: number;
  name: { en: string; de: string };
  hazardType: string;
  gate: 'weather' | 'detection';
  armed: boolean;
  temperatureGapC?: number;
  soilMoistureGapPct?: number;
}

export interface CurrentConditions {
  available: boolean;
  observedAt?: string;
  cycleAt?: string;
  temperatureC?: number;
  relativeHumidityPct?: number;
  windSpeedKmh?: number | null;
  windDirectionDeg?: number | null;
  soilMoisturePct?: number;
  stationId?: string;
  area?: string;
  zones: ZoneReadiness[];
}

/** Ingestion runs every ~5 minutes; polling faster would only waste requests. */
const REFRESH_MS = 120_000;

@Injectable({ providedIn: 'root' })
export class ConditionsService {
  private readonly resource = polledResource<CurrentConditions>(
    '/api/conditions',
    REFRESH_MS,
  );

  readonly conditions: Signal<CurrentConditions | null> = this.resource.value;

  refresh(): Promise<void> {
    return this.resource.refresh();
  }
}
