/**
 * The hazard polygons: what this map exists to show.
 *
 * Rendered with an ominous "glow" composed from three layers, because
 * MapLibre has no box-shadow: a deep dark-red fill, a wide blurred line
 * underneath, and a crisp bright core line on top.
 *
 * The source is registered EMPTY and filled afterwards. Registering source
 * and layers synchronously keeps the paint order deterministic — zones below
 * the detections — where waiting for the data would let a slow response stack
 * the polygons on top of the very detections they are meant to sit under.
 */

import { Injectable, inject } from '@angular/core';
import { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';

import { ZoneApiService } from '@features/zones/data-access/zone-api.service';

const SOURCE = 'high-risk-zones';

@Injectable({ providedIn: 'root' })
export class RiskZoneOverlay {
  private readonly zoneApi = inject(ZoneApiService);
  private map?: MapLibreMap;

  /** Present after install() — also what tells the map the style is dressed. */
  static readonly SOURCE = SOURCE;

  install(map: MapLibreMap): void {
    this.map = map;

    map.addSource(SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    // 1) Deep, semi-transparent dark-red interior.
    map.addLayer({
      id: 'risk-zones-fill',
      type: 'fill',
      source: SOURCE,
      paint: { 'fill-color': '#3b0000', 'fill-opacity': 0.4 },
    });

    // 2) The halo: wide, heavily blurred red line — the "glow" itself.
    map.addLayer({
      id: 'risk-zones-glow',
      type: 'line',
      source: SOURCE,
      paint: {
        'line-color': '#ff2d1a',
        'line-width': 10,
        'line-blur': 8,
        'line-opacity': 0.55,
      },
    });

    // 3) The core: thin, bright, sharp boundary line drawn over the halo.
    map.addLayer({
      id: 'risk-zones-outline',
      type: 'line',
      source: SOURCE,
      paint: { 'line-color': '#ff4d4d', 'line-width': 1.5 },
    });
  }

  /**
   * Load the polygons from the database via the API.
   *
   * Zones are operator data: adding one is a SQL statement, and it shows up
   * here on the next load with no rebuild of any service.
   */
  async load(): Promise<void> {
    const source = this.map?.getSource(SOURCE) as GeoJSONSource | undefined;
    if (!source) return; // map or style not ready yet
    try {
      source.setData(await this.zoneApi.geoJson());
    } catch {
      // The map stays usable without the overlay; live alerts are unaffected.
    }
  }
}
