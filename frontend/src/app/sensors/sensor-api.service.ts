/**
 * SensorApiService — reads and manages ground sensors.
 *
 * Mirrors ZoneApiService: public reads, operator-key writes through the
 * shared OperatorKeyService, and a `revision` signal the map watches so a
 * newly placed sensor appears without a reload.
 */

import { Injectable, inject, signal } from '@angular/core';

import { OperatorKeyService } from '../core/services/operator-key.service';

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
  private readonly operatorKey = inject(OperatorKeyService);

  /** Bumped after every successful write; the map re-fetches on change. */
  readonly revision = signal(0);

  async list(): Promise<SensorInfo[]> {
    const response = await fetch('/api/sensors');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as SensorInfo[];
  }

  create(payload: SensorPayload): Promise<void> {
    return this.write('/api/sensors', 'POST', payload);
  }

  update(id: number, payload: SensorPayload): Promise<void> {
    return this.write(`/api/sensors/${id}`, 'PUT', payload);
  }

  retire(id: number): Promise<void> {
    return this.write(`/api/sensors/${id}`, 'DELETE');
  }

  private async write(
    url: string,
    method: 'POST' | 'PUT' | 'DELETE',
    payload?: SensorPayload,
  ): Promise<void> {
    const key = this.operatorKey.read();
    if (!key) throw new Error('locked');

    const response = await fetch(url, {
      method,
      headers: {
        'X-API-Key': key,
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (response.ok) {
      this.revision.update((n) => n + 1);
      return;
    }

    if (response.status === 401) {
      this.operatorKey.clear();
      throw new Error('locked');
    }
    // Surface the API's own message — it names the exact problem ("already
    // registered and active", calibration bounds, …).
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const detail = Array.isArray(body?.message)
      ? body!.message.join('; ')
      : (body?.message ?? `HTTP ${response.status}`);
    throw new Error(detail);
  }
}
