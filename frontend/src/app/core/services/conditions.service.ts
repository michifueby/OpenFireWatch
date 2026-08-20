/**
 * ConditionsService — polls the current ground conditions.
 *
 * Refreshed on a timer rather than pushed: conditions change on the ingestion
 * cadence (minutes), so a WebSocket channel would add machinery for data that
 * is never urgent. Alerts are the urgent part, and those already stream.
 */

import { Injectable, NgZone, OnDestroy, signal } from '@angular/core';

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
  soilMoisturePct?: number;
  stationId?: string;
  area?: string;
  zones: ZoneReadiness[];
}

/** Ingestion runs every ~5 minutes; polling faster would only waste requests. */
const REFRESH_MS = 120_000;

@Injectable({ providedIn: 'root' })
export class ConditionsService implements OnDestroy {
  readonly conditions = signal<CurrentConditions | null>(null);

  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly zone: NgZone) {
    void this.refresh();
    // Outside Angular's zone so the interval does not trigger change
    // detection on every tick; refresh() re-enters when data actually lands.
    this.zone.runOutsideAngular(() => {
      this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    });
  }

  async refresh(): Promise<void> {
    try {
      const response = await fetch('/api/conditions');
      if (!response.ok) return;
      const data = (await response.json()) as CurrentConditions;
      this.zone.run(() => this.conditions.set(data));
    } catch {
      // Keep the last known values rather than blanking the panel.
    }
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
