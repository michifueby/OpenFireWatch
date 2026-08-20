/**
 * MapComponent — the situational-awareness map for emergency responders.
 *
 * Responsibilities:
 *   1. Initialize a MapLibre GL JS map centered on Neunkirchen, Austria.
 *   2. Draw the high-risk zone polygons fetched from `GET /api/risk-zones`,
 *      so responders always see WHERE the hazard is — and so adding a zone
 *      needs no frontend change.
 *   3. Stream every broadcast anomaly into a GeoJSON circle layer, and drop
 *      a prominent pulsing marker (with a detail popup) for each
 *      critical escalation, whatever the hazard type.
 *
 * Memory-leak hygiene: the RxJS subscription, every Marker, and the map
 * instance itself are all torn down in ngOnDestroy — MapLibre holds WebGL
 * contexts and DOM listeners that survive component destruction unless
 * `map.remove()` is called explicitly.
 */

import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
} from '@angular/core';
import maplibregl, { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { Subscription } from 'rxjs';

import { TranslationService } from '../core/i18n/translation.service';
import { ZoneApiService } from '../zones/zone-api.service';
import { ZoneDrawService } from '../zones/zone-draw.service';
import { AnomalyAlert } from '../core/models/alert.model';
import { RealTimeAlertService } from '../core/services/real-time-alert.service';

/** Neunkirchen, Lower Austria — operational center of the demo deployment. */
const NEUNKIRCHEN_LNG_LAT: [number, number] = [16.081, 47.723];

/** MapLibre source/layer ids, kept as constants to avoid stringly typos. */
const RISK_ZONE_SOURCE = 'high-risk-zones';
const ANOMALIES_SOURCE = 'anomalies';

@Component({
  selector: 'ofw-map',
  standalone: true,
  template: `<div #mapContainer class="map"></div>`,
  styles: [
    `
      :host,
      .map {
        display: block;
        height: 100vh;
      }
    `,
  ],
})
export class MapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: true })
  private readonly mapContainer!: ElementRef<HTMLDivElement>;

  private map!: MapLibreMap;
  private readonly subscriptions = new Subscription();
  /** Live markers we created — tracked so ngOnDestroy can remove them all. */
  private readonly criticalMarkers: maplibregl.Marker[] = [];
  private readonly anomalyFeatures: GeoJSON.Feature[] = [];

  constructor(
    private readonly alerts: RealTimeAlertService,
    private readonly i18n: TranslationService,
    private readonly draw: ZoneDrawService,
    private readonly zoneApi: ZoneApiService,
  ) {
    // Re-draw the overlay whenever the editor writes a zone. Guarded inside
    // loadRiskZones(), so firing before the map is ready is harmless.
    effect(() => {
      this.zoneApi.revision();
      void this.loadRiskZones();
    });
  }

  ngAfterViewInit(): void {
    this.map = new maplibregl.Map({
      container: this.mapContainer.nativeElement,
      // CartoDB "Dark Matter": free, high-quality dark basemap that lets the
      // red hazard styling carry all the visual weight (attribution included
      // in the style; check Carto's terms before heavy production use).
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: NEUNKIRCHEN_LNG_LAT,
      zoom: 10,
      attributionControl: { compact: true },
    });
    this.map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

    // Sources/layers can only be added once the style has loaded.
    this.map.on('load', () => {
      this.drawRiskZones();
      this.initAnomalyLayer();
      // Drawing layers are registered last so the draft paints on top.
      this.draw.attach(this.map);
      void this.loadRiskZones();
      void this.loadAnomalyHistory();
      this.subscribeToRealtimeAlerts();
    });
  }

  /**
   * Render the high-risk zones with an ominous "glow": a deep dark-red fill,
   * a wide blurred halo line underneath, and a crisp bright core line on
   * top. MapLibre has no box-shadow, so the glow is composed from two line
   * layers — `line-blur` diffuses the wide one into a halo.
   *
   * The source starts EMPTY and is filled asynchronously from
   * `GET /api/risk-zones`. Registering source and layers synchronously keeps
   * the paint order deterministic (zones below the anomaly circles); loading
   * the data afterwards via `setData` would otherwise let a slow response
   * stack the polygons on top of the detections and hide them.
   */
  private drawRiskZones(): void {
    this.map.addSource(RISK_ZONE_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    // 1) Deep, semi-transparent dark-red interior.
    this.map.addLayer({
      id: 'risk-zones-fill',
      type: 'fill',
      source: RISK_ZONE_SOURCE,
      paint: {
        'fill-color': '#3b0000',
        'fill-opacity': 0.4,
      },
    });

    // 2) The halo: wide, heavily blurred red line — the "glow" itself.
    this.map.addLayer({
      id: 'risk-zones-glow',
      type: 'line',
      source: RISK_ZONE_SOURCE,
      paint: {
        'line-color': '#ff2d1a',
        'line-width': 10,
        'line-blur': 8,
        'line-opacity': 0.55,
      },
    });

    // 3) The core: thin, bright, sharp boundary line drawn over the halo.
    this.map.addLayer({
      id: 'risk-zones-outline',
      type: 'line',
      source: RISK_ZONE_SOURCE,
      paint: {
        'line-color': '#ff4d4d',
        'line-width': 1.5,
      },
    });
  }

  /**
   * Load the hazard polygons from the database via the API.
   *
   * Zones are operator data: adding one is a SQL statement, and it shows up
   * here on the next page load with no rebuild of any service.
   */
  private async loadRiskZones(): Promise<void> {
    const source = this.map?.getSource(RISK_ZONE_SOURCE) as GeoJSONSource | undefined;
    if (!source) return; // map or style not ready yet
    try {
      const response = await fetch('/api/risk-zones');
      if (!response.ok) return;
      const zones = (await response.json()) as GeoJSON.FeatureCollection;
      source.setData(zones);
    } catch {
      // The map stays usable without the overlay; live alerts are unaffected.
    }
  }

  /** Circle layer for ALL broadcast anomalies (ELEVATED and CRITICAL). */
  private initAnomalyLayer(): void {
    this.map.addSource(ANOMALIES_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    this.map.addLayer({
      id: 'anomalies-circles',
      type: 'circle',
      source: ANOMALIES_SOURCE,
      paint: {
        'circle-radius': 4.5,
        'circle-color': '#ffb703', // amber: visible but subordinate to critical red
        'circle-opacity': 0.9,
        'circle-stroke-color': '#05070c', // dark halo separates dots from basemap
        'circle-stroke-width': 1.5,
      },
    });
  }

  /** Initial state: recent anomalies from the REST read model. */
  private async loadAnomalyHistory(): Promise<void> {
    try {
      const response = await fetch('/api/anomalies?limit=1000');
      if (!response.ok) return;
      const collection = (await response.json()) as GeoJSON.FeatureCollection;
      this.anomalyFeatures.push(...collection.features);
      this.refreshAnomalySource();
    } catch {
      // History is a nice-to-have; live alerts still work without it.
    }
  }

  /**
   * Task 3: live updates. Every broadcast alert extends the circle layer;
   * CRITICAL escalations additionally get a prominent pulsing marker.
   */
  private subscribeToRealtimeAlerts(): void {
    this.subscriptions.add(
      this.alerts.anomalies$.subscribe((alert) => {
        this.anomalyFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [alert.longitude, alert.latitude],
          },
          properties: { id: alert.id, level: alert.level },
        });
        this.refreshAnomalySource();
      }),
    );

    this.subscriptions.add(
      this.alerts.criticalAlerts$.subscribe((alert) => this.addCriticalMarker(alert)),
    );
  }

  /** Drop a pulsing red marker with a detail popup at the exact coordinates. */
  private addCriticalMarker(alert: AnomalyAlert): void {
    // Custom DOM element — the pulse animation lives in global styles.css
    // because Marker elements are attached outside Angular's view tree.
    const element = document.createElement('div');
    element.className = 'ofw-critical-marker';
    element.title = `${this.i18n.t('criticalMarkerTitle')}: ${this.i18n.levelLabel(alert.level)}`;

    const marker = new maplibregl.Marker({ element })
      .setLngLat([alert.longitude, alert.latitude])
      .setPopup(this.buildPopup(alert))
      .addTo(this.map);
    this.criticalMarkers.push(marker);

    // Pull the operator's eyes to the incident without yanking the zoom out.
    this.map.flyTo({
      center: [alert.longitude, alert.latitude],
      zoom: Math.max(this.map.getZoom(), 12),
      speed: 0.8,
    });
  }

  /**
   * Popup built via DOM APIs (never innerHTML) — no injection surface.
   * Rendered in the language active at alert time (a later language switch
   * does not retro-translate popups that are already on screen).
   */
  private buildPopup(alert: AnomalyAlert): maplibregl.Popup {
    const container = document.createElement('div');
    container.className = 'ofw-popup';

    const title = document.createElement('strong');
    title.textContent = `🚨 ${this.i18n.levelLabel(alert.level)}`;
    container.appendChild(title);

    const t = (key: Parameters<TranslationService['t']>[0]): string =>
      this.i18n.t(key);
    const lines = [
      `${t('popupZone')}: ${alert.zone ? this.i18n.pick(alert.zone.name) : t('popupNoZone')}`,
      `${t('popupTemperature')}: ${alert.weather.temperatureC} °C`,
      `${t('popupSoilMoisture')}: ${alert.weather.soilMoisturePct} %`,
      `${t('popupCoordinates')}: ${alert.latitude.toFixed(4)}, ${alert.longitude.toFixed(4)}`,
      `${t('popupAcquired')}: ${new Date(alert.acquiredAt).toLocaleString()}`,
    ];
    for (const text of lines) {
      const row = document.createElement('div');
      row.textContent = text;
      container.appendChild(row);
    }

    return new maplibregl.Popup({ offset: 18, closeButton: true }).setDOMContent(
      container,
    );
  }

  private refreshAnomalySource(): void {
    const source = this.map.getSource(ANOMALIES_SOURCE) as GeoJSONSource | undefined;
    source?.setData({ type: 'FeatureCollection', features: this.anomalyFeatures });
  }

  /** Leak-free teardown: streams, markers, then the WebGL map itself. */
  ngOnDestroy(): void {
    this.draw.detach();
    this.subscriptions.unsubscribe();
    this.criticalMarkers.forEach((marker) => marker.remove());
    this.criticalMarkers.length = 0;
    this.map?.remove();
  }
}
