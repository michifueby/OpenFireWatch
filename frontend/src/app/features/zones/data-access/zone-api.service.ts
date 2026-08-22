/**
 * ZoneApiService — reads and writes hazard zones.
 *
 * A repository over the zone endpoints: the rest of the application asks for
 * zones and hands over payloads, and never learns what a URL or a status code
 * looks like. Credential handling and error shaping happen a layer below, in
 * the interceptor and in ApiClient.
 */

import { Injectable, inject, signal } from '@angular/core';

import { ApiClient } from '@core/api/api-client';
import { ApiError } from '@core/api/api-error';
import { OperatorKeyService } from '@core/api/operator-key.service';
import { LocalizedName } from '@core/models/alert.model';

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
  private readonly api = inject(ApiClient);
  private readonly operatorKey = inject(OperatorKeyService);

  /** Whether an operator key is present in this tab. */
  readonly unlocked = this.operatorKey.unlocked;

  /**
   * Bumped after every successful write. The map watches it and re-fetches
   * the overlay, so a zone saved in the editor appears immediately instead
   * of only after a reload.
   */
  readonly revision = signal(0);

  /**
   * The zones as GeoJSON, exactly as the map's source wants them.
   *
   * Public read — no key required. Kept separate from `list()` because the
   * map needs the collection whole and the editor needs it flattened; both
   * mapping it would put two readers of the same payload in two files.
   */
  geoJson(): Promise<GeoJSON.FeatureCollection> {
    return this.api.get<GeoJSON.FeatureCollection>('/api/risk-zones');
  }

  /** The same zones, flattened for the operator list. */
  async list(): Promise<ZoneListItem[]> {
    const collection = await this.geoJson();
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
   *
   * The probe posts a deliberately empty body: a valid key gets past the
   * guard and is then turned away by DTO validation with 400, an invalid one
   * is rejected by the guard itself with 401. Either answer identifies the
   * key, and neither creates anything.
   */
  async unlock(key: string): Promise<boolean> {
    try {
      await this.api.post('/api/risk-zones', {}, { operatorKey: key });
    } catch (error) {
      if (error instanceof ApiError && error.locked) {
        this.lock();
        return false;
      }
      // Any other answer means the guard let the key through.
    }
    this.operatorKey.store(key);
    return true;
  }

  lock(): void {
    this.operatorKey.clear();
  }

  create(payload: ZonePayload): Promise<void> {
    return this.write(this.api.post('/api/risk-zones', payload));
  }

  update(id: number, payload: ZonePayload): Promise<void> {
    return this.write(this.api.put(`/api/risk-zones/${id}`, payload));
  }

  retire(id: number): Promise<void> {
    return this.write(this.api.delete(`/api/risk-zones/${id}`));
  }

  /**
   * Every write goes through here for one reason: `revision` must be bumped
   * on success and never on failure, and a caller that has to remember to do
   * that will eventually forget.
   */
  private async write(operation: Promise<unknown>): Promise<void> {
    await operation;
    this.revision.update((n) => n + 1);
  }
}
