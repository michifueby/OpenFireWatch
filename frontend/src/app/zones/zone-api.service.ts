/**
 * ZoneApiService — reads and writes hazard zones.
 *
 * Credential handling: the operator key is kept in `sessionStorage`, not
 * `localStorage`, so it disappears when the tab closes instead of persisting
 * on a shared workstation. It is only ever sent to the same origin as the
 * app, in the `X-API-Key` header — never in a URL, where it would end up in
 * server logs and browser history.
 */

import { Injectable, signal } from '@angular/core';

import { LocalizedName } from '../core/models/alert.model';

const KEY_STORAGE = 'ofw-operator-key';

export type HazardType =
  | 'white_phosphorus'
  | 'wildfire'
  | 'ammunition_depot'
  | 'generic';

/** One zone as rendered in the editor list. */
export interface ZoneListItem {
  id: number;
  name: LocalizedName;
  hazardType: HazardType;
  geometry: GeoJSON.Polygon;
}

export interface ZonePayload {
  nameEn: string;
  nameDe: string;
  hazardType: HazardType;
  geometry: GeoJSON.Polygon;
}

@Injectable({ providedIn: 'root' })
export class ZoneApiService {
  /** Whether an operator key is present in this tab. */
  readonly unlocked = signal<boolean>(!!readStoredKey());

  /**
   * Bumped after every successful write. The map watches it and re-fetches
   * the overlay, so a zone saved in the editor appears immediately instead
   * of only after a reload.
   */
  readonly revision = signal(0);

  /** Public read — no key required. */
  async list(): Promise<ZoneListItem[]> {
    const response = await fetch('/api/risk-zones');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const collection = (await response.json()) as GeoJSON.FeatureCollection;
    return collection.features.map((feature) => {
      const props = (feature.properties ?? {}) as {
        id: number;
        name: LocalizedName;
        hazardType: HazardType;
      };
      return {
        id: props.id,
        name: props.name,
        hazardType: props.hazardType,
        geometry: feature.geometry as GeoJSON.Polygon,
      };
    });
  }

  /**
   * Store the key after proving it works, so an invalid key is reported
   * immediately instead of on the first save attempt.
   */
  async unlock(key: string): Promise<boolean> {
    const probe = await fetch('/api/risk-zones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      // Deliberately empty: a valid key fails DTO validation with 400,
      // an invalid one is rejected by the guard with 401. Either way the
      // probe never creates anything.
      body: '{}',
    });
    if (probe.status === 401 || probe.status === 503) {
      this.lock();
      return false;
    }
    sessionStorage.setItem(KEY_STORAGE, key);
    this.unlocked.set(true);
    return true;
  }

  lock(): void {
    sessionStorage.removeItem(KEY_STORAGE);
    this.unlocked.set(false);
  }

  create(payload: ZonePayload): Promise<void> {
    return this.write('/api/risk-zones', 'POST', payload);
  }

  update(id: number, payload: ZonePayload): Promise<void> {
    return this.write(`/api/risk-zones/${id}`, 'PUT', payload);
  }

  retire(id: number): Promise<void> {
    return this.write(`/api/risk-zones/${id}`, 'DELETE');
  }

  private async write(
    url: string,
    method: 'POST' | 'PUT' | 'DELETE',
    payload?: ZonePayload,
  ): Promise<void> {
    const key = readStoredKey();
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
      this.lock();
      throw new Error('locked');
    }
    // Surface the API's own validation message — it names the exact problem
    // ("ring must be closed", "position out of WGS84 bounds", …).
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const detail = Array.isArray(body?.message)
      ? body!.message.join('; ')
      : (body?.message ?? `HTTP ${response.status}`);
    throw new Error(detail);
  }
}

function readStoredKey(): string | null {
  try {
    return sessionStorage.getItem(KEY_STORAGE);
  } catch {
    return null; // storage blocked (private mode) — the editor stays locked
  }
}
