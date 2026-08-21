/**
 * ForecastService — the seven-day ignition outlook.
 *
 * Polled on a slow timer rather than pushed: the forecast is refreshed hourly
 * on the server and changes over days. A WebSocket for it would be machinery
 * in service of nothing.
 */

import { Injectable, NgZone, OnDestroy, signal } from '@angular/core';

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
export class ForecastService implements OnDestroy {
  readonly forecast = signal<ForecastSnapshot | null>(null);

  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly zone: NgZone) {
    void this.refresh();
    // Outside Angular's zone so the interval does not drive change detection
    // on its own; the signal update inside does that where it matters.
    this.zone.runOutsideAngular(() => {
      this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    });
  }

  async refresh(): Promise<void> {
    try {
      const response = await fetch('/api/forecast');
      if (!response.ok) return;
      const snapshot = (await response.json()) as ForecastSnapshot;
      this.zone.run(() => this.forecast.set(snapshot));
    } catch {
      // The rest of the picture works without an outlook.
    }
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
