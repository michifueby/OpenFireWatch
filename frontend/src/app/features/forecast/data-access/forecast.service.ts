/**
 * ForecastService — the seven-day ignition outlook.
 *
 * Polled on a slow timer rather than pushed: the forecast is refreshed hourly
 * on the server and changes over days. A WebSocket for it would be machinery
 * in service of nothing.
 */

import { Injectable, Signal } from '@angular/core';

import { polledResource } from '@core/api/polled-resource';

/** One continuous run of hours in which both ignition criteria hold. */
export interface IgnitionWindow {
  from: string;
  to: string;
  peakTemperatureC: number;
  minSoilMoisturePct: number;
}

export interface ZoneForecast {
  zoneId: number;
  name: { de: string; en: string };
  hazardType: string;
  /** False where escalation does not depend on weather — see the API. */
  weatherGated: boolean;
  windows: IgnitionWindow[];
  hoursUntilNextWindow: number | null;
  soilAlreadyDry: boolean;
}

export interface ForecastSnapshot {
  available: boolean;
  generatedAt: string | null;
  zones: ZoneForecast[];
}

/** The server refreshes hourly; asking more often would learn nothing. */
const REFRESH_MS = 15 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class ForecastService {
  private readonly resource = polledResource<ForecastSnapshot>(
    '/api/forecast',
    REFRESH_MS,
  );

  readonly forecast: Signal<ForecastSnapshot | null> = this.resource.value;

  refresh(): Promise<void> {
    return this.resource.refresh();
  }
}
