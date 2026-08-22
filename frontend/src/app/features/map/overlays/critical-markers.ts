/**
 * The pulsing red markers: one per outstanding critical warning.
 *
 * Reconciled against the list of what is unacknowledged rather than appended
 * from the stream of what is new. That list is rebuilt from the REST history
 * on startup, so markers survive a reload, and it shrinks on acknowledgement,
 * so a dot stops pulsing once somebody has taken the alarm. The map and the
 * panel therefore cannot disagree about what is still outstanding.
 */

import { Injectable, inject } from '@angular/core';
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';

import { TranslationService } from '@core/i18n/translation.service';
import { AnomalyAlert } from '@core/models/alert.model';

import { buildAlertPopup } from './map-popup';

@Injectable({ providedIn: 'root' })
export class CriticalMarkers {
  private readonly i18n = inject(TranslationService);

  private map?: MapLibreMap;
  /** By anomaly id, so the set can be reconciled and torn down. */
  private readonly markers = new Map<number, maplibregl.Marker>();

  attach(map: MapLibreMap): void {
    this.map = map;
  }

  /** Bring the markers on the map in line with the outstanding warnings. */
  sync(warnings: readonly AnomalyAlert[]): void {
    if (!this.map) return;

    const outstanding = new Set(warnings.map((warning) => warning.id));
    for (const [id, marker] of this.markers) {
      if (outstanding.has(id)) continue;
      marker.remove();
      this.markers.delete(id);
    }

    for (const warning of warnings) {
      if (this.markers.has(warning.id)) continue;
      this.markers.set(warning.id, this.create(warning));
    }
  }

  clear(): void {
    this.markers.forEach((marker) => marker.remove());
    this.markers.clear();
  }

  private create(alert: AnomalyAlert): maplibregl.Marker {
    // Custom DOM element — the pulse animation lives in the global stylesheet
    // because Marker elements are attached outside Angular's view tree.
    const element = document.createElement('div');
    element.className = 'ofw-critical-marker';
    element.title = `${this.i18n.t('criticalMarkerTitle')}: ${this.i18n.levelLabel(alert.level)}`;
    // The visible dot is a child so the outer element can be a finger-sized
    // hit area without inflating how large the detection itself looks.
    const core = document.createElement('div');
    core.className = 'ofw-critical-marker__core';
    element.appendChild(core);

    return new maplibregl.Marker({ element })
      .setLngLat([alert.longitude, alert.latitude])
      .setPopup(buildAlertPopup(alert, this.i18n))
      .addTo(this.map!);
  }
}
