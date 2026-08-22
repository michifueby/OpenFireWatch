/**
 * SensorApiService — reads and manages ground sensors.
 *
 * Mirrors ZoneApiService: a repository over the sensor endpoints, with a
 * `revision` signal the map watches so a newly placed sensor appears without
 * a reload. The operator key is attached by the interceptor.
 */

import { Injectable, inject, signal } from '@angular/core';

import { ApiClient } from '@core/api/api-client';

/** One sensor as served by GET /api/sensors. */
export interface SensorInfo {
  id: number;
  deviceId: string;
  label: string;
  latitude: number;
  longitude: number;
  /** Derived from position via ST_Intersects — never stored, never typed. */
  zoneId: number | null;
  lastSeenAt: string | null;
  reporting: boolean;
  temperatureC: number | null;
  soilMoisturePct: number | null;
  batteryPct: number | null;
  /** Calibration in effect — the editor round-trips it. */
  temperatureOffsetC: number;
  soilMoistureScale: number;
  soilMoistureOffsetPct: number;
}

export interface SensorPayload {
  deviceId: string;
  label: string;
  latitude: number;
  longitude: number;
  temperatureOffsetC?: number;
  soilMoistureScale?: number;
  soilMoistureOffsetPct?: number;
}

@Injectable({ providedIn: 'root' })
export class SensorApiService {
  private readonly api = inject(ApiClient);

  /** Bumped after every successful write; the map re-fetches on change. */
  readonly revision = signal(0);

  list(): Promise<SensorInfo[]> {
    return this.api.get<SensorInfo[]>('/api/sensors');
  }

  create(payload: SensorPayload): Promise<void> {
    return this.write(this.api.post('/api/sensors', payload));
  }

  update(id: number, payload: SensorPayload): Promise<void> {
    return this.write(this.api.put(`/api/sensors/${id}`, payload));
  }

  retire(id: number): Promise<void> {
    return this.write(this.api.delete(`/api/sensors/${id}`));
  }

  /** Success — and only success — advances the revision the map watches. */
  private async write(operation: Promise<unknown>): Promise<void> {
    await operation;
    this.revision.update((n) => n + 1);
  }
}
