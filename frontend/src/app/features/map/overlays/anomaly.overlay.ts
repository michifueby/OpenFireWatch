/**
 * Every broadcast detection as an amber circle — visible, but subordinate to
 * the red of a critical marker.
 *
 * Feeds from two directions at once: the REST history on startup and the live
 * stream thereafter. They overlap, because an anomaly is persisted before it
 * is broadcast, so one that arrives while the history request is in flight
 * comes down both paths. Stacking two identical circles would be invisible
 * and dishonest, which is what the id set prevents.
 */

import { Injectable, inject } from '@angular/core';
import { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';

import { ApiClient } from '@core/api/api-client';
import { AnomalyAlert } from '@core/models/alert.model';

const SOURCE = 'anomalies';

@Injectable({ providedIn: 'root' })
export class AnomalyOverlay {
  private readonly api = inject(ApiClient);

  private map?: MapLibreMap;
  private readonly features: GeoJSON.Feature[] = [];
  private readonly plotted = new Set<number>();

  install(map: MapLibreMap): void {
    this.map = map;

    map.addSource(SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    map.addLayer({
      id: 'anomalies-circles',
      type: 'circle',
      source: SOURCE,
      paint: {
        'circle-radius': 4.5,
        'circle-color': '#ffb703',
        'circle-opacity': 0.9,
        'circle-stroke-color': '#05070c', // dark halo separates dots from basemap
        'circle-stroke-width': 1.5,
      },
    });
  }

  /**
   * Recent detections from the REST read model — the last week, like the
   * history panel. Bounded by date on purpose: the archive backfill can put
   * a decade of detections into the same table, and the live map is not the
   * place to draw them. They are reachable through the API with `since`.
   */
  async loadHistory(): Promise<void> {
    try {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const collection = await this.api.get<GeoJSON.FeatureCollection>(
        `/api/anomalies?limit=1000&since=${encodeURIComponent(since)}`,
      );
      for (const feature of collection.features) {
        this.remember(Number(feature.properties?.['id']), feature);
      }
      this.repaint();
    } catch {
      // History is a nice-to-have; live alerts still work without it.
    }
  }

  /** One detection off the live stream. */
  add(alert: AnomalyAlert): void {
    const added = this.remember(alert.id, {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [alert.longitude, alert.latitude] },
      properties: { id: alert.id, level: alert.level },
    });
    if (added) this.repaint();
  }

  /**
   * Paint whatever has been collected. Called after installing too: anything
   * that streamed in while the style was loading is already held here, and
   * this is the first moment it can be shown.
   */
  repaint(): void {
    const source = this.map?.getSource(SOURCE) as GeoJSONSource | undefined;
    source?.setData({ type: 'FeatureCollection', features: this.features });
  }

  private remember(id: number, feature: GeoJSON.Feature): boolean {
    if (this.plotted.has(id)) return false;
    this.plotted.add(id);
    this.features.push(feature);
    return true;
  }
}
