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
import { ConditionsService } from '../core/services/conditions.service';
import { ZoneApiService } from '../zones/zone-api.service';
import { ZoneDrawService } from '../zones/zone-draw.service';
import { AnomalyAlert } from '../core/models/alert.model';
import { RealTimeAlertService } from '../core/services/real-time-alert.service';

/** Neunkirchen, Lower Austria — operational center of the demo deployment. */
const NEUNKIRCHEN_LNG_LAT: [number, number] = [16.081, 47.723];

/**
 * Where down the screen an incident is placed when the situation sheet is
 * lying across the bottom of the map.
 *
 * Bounded on both sides: below the ~56 px the launcher and credit bar occupy
 * along the top edge, and above the sheet, whose height the stylesheet caps
 * at 60dvh plus its handle. On the shortest phone in common use that leaves
 * the band roughly 0.10–0.25; a fifth of the way down sits inside it with
 * room to spare at either end.
 */
const INCIDENT_SCREEN_FRACTION = 0.2;

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
        // 100vh on a phone means "viewport with the URL bar hidden", so the
        // bottom of the map — and anything anchored to it — is cropped until
        // the user scrolls. dvh tracks the actually visible height; vh stays
        // as the fallback for browsers without it.
        height: 100vh;
        height: 100dvh;
      }
    `,
  ],
})
export class MapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: true })
  private readonly mapContainer!: ElementRef<HTMLDivElement>;

  private map!: MapLibreMap;
  private readonly subscriptions = new Subscription();
  /** Pulsing markers by anomaly id, so the set can be reconciled and torn down. */
  private readonly criticalMarkers = new Map<number, maplibregl.Marker>();
  private readonly anomalyFeatures: GeoJSON.Feature[] = [];
  /**
   * Anomaly ids already on the circle layer. The live stream and the REST
   * history overlap — an anomaly is persisted before it is broadcast, so one
   * that arrives while the history request is in flight comes down both
   * paths — and stacking two identical circles is invisible but dishonest.
   */
  private readonly plottedAnomalyIds = new Set<number>();
  /** Zone ids the overlay currently reflects, to detect changes cheaply. */
  private knownZoneIds = '';

  constructor(
    private readonly alerts: RealTimeAlertService,
    private readonly i18n: TranslationService,
    private readonly draw: ZoneDrawService,
    private readonly zoneApi: ZoneApiService,
    private readonly conditions: ConditionsService,
  ) {
    // Re-draw the overlay whenever the editor writes a zone. Guarded inside
    // loadRiskZones(), so firing before the map is ready is harmless.
    effect(() => {
      this.zoneApi.revision();
      void this.loadRiskZones();
    });

    // ...and whenever the set of zones changes underneath us.
    //
    // The editor is not the only way zones appear: the documented path for
    // zones that must survive a rebuild is plain SQL (deploy/zones/*.sql).
    // Those never went through `revision`, so the overlay kept showing the
    // zones that existed at page load while the conditions panel — which
    // polls — already listed the new ones. Two parts of the same screen
    // disagreeing about which zones exist is worse than either being stale.
    effect(() => {
      const ids = (this.conditions.conditions()?.zones ?? [])
        .map((z) => z.id)
        .sort((a, b) => a - b)
        .join(',');
      if (ids && ids !== this.knownZoneIds) {
        this.knownZoneIds = ids;
        void this.loadRiskZones();
      }
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

    // Subscribed here rather than inside the load handler below. The style
    // sheet is fetched over the network and takes a second or two; an alert
    // that arrived in that window used to find nobody listening, and its
    // marker was lost for good — the panel listed the alarm, the map showed
    // nothing. Markers and camera moves need the map object, which exists
    // now; only sources and layers have to wait for the style.
    this.subscribeToRealtimeAlerts();

    // Sources/layers can only be added once the style has loaded.
    this.map.on('load', () => {
      this.drawRiskZones();
      this.initAnomalyLayer();
      // Drawing layers are registered last so the draft paints on top.
      this.draw.attach(this.map);
      void this.loadRiskZones();
      void this.loadAnomalyHistory();
      // Anything that streamed in while the style was still loading is
      // already collected; this is the first moment it can be painted.
      this.refreshAnomalySource();
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
      for (const feature of collection.features) {
        const id = Number(feature.properties?.['id']);
        if (this.plottedAnomalyIds.has(id)) continue;
        this.plottedAnomalyIds.add(id);
        this.anomalyFeatures.push(feature);
      }
      this.refreshAnomalySource();
    } catch {
      // History is a nice-to-have; live alerts still work without it.
    }
  }

  /**
   * Live updates. Every broadcast alert extends the circle layer; every
   * outstanding critical warning gets a prominent pulsing marker.
   */
  private subscribeToRealtimeAlerts(): void {
    this.subscriptions.add(
      this.alerts.anomalies$.subscribe((alert) => {
        if (this.plottedAnomalyIds.has(alert.id)) return;
        this.plottedAnomalyIds.add(alert.id);
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

    // Markers mirror the list of unacknowledged warnings rather than the
    // stream of new ones. That list is rebuilt from the REST history on
    // startup, so markers survive a reload, and it shrinks on acknowledgement,
    // so a dot stops pulsing once somebody has taken the alarm — the map and
    // the panel can no longer disagree about what is still outstanding.
    this.subscriptions.add(
      this.alerts.activeWarnings$.subscribe((warnings) =>
        this.syncCriticalMarkers(warnings),
      ),
    );

    // The camera reacts to news, not to state: flying on the warning list
    // would yank the view somewhere every time the history is restored or an
    // unrelated alarm is acknowledged.
    this.subscriptions.add(
      this.alerts.criticalAlerts$.subscribe((alert) => this.flyToIncident(alert)),
    );
  }

  /** Bring the markers on the map in line with the outstanding warnings. */
  private syncCriticalMarkers(warnings: readonly AnomalyAlert[]): void {
    const outstanding = new Set(warnings.map((warning) => warning.id));

    for (const [id, marker] of this.criticalMarkers) {
      if (outstanding.has(id)) continue;
      marker.remove();
      this.criticalMarkers.delete(id);
    }

    for (const warning of warnings) {
      if (this.criticalMarkers.has(warning.id)) continue;
      this.criticalMarkers.set(warning.id, this.addCriticalMarker(warning));
    }
  }

  /** Drop a pulsing red marker with a detail popup at the exact coordinates. */
  private addCriticalMarker(alert: AnomalyAlert): maplibregl.Marker {
    // Custom DOM element — the pulse animation lives in global styles.css
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
      .setPopup(this.buildPopup(alert))
      .addTo(this.map);
  }

  /** Pull the operator's eyes to an incident without yanking the zoom out. */
  private flyToIncident(alert: AnomalyAlert): void {
    this.map.flyTo({
      center: [alert.longitude, alert.latitude],
      zoom: Math.max(this.map.getZoom(), 12),
      speed: 0.8,
      offset: this.incidentScreenOffset(),
    });
  }

  /**
   * How far from the centre of the map an incident should be placed.
   *
   * Deliberately a fixed fraction of the screen rather than a measurement of
   * the situation sheet: the alert that triggers this camera move is also the
   * one that opens the sheet and adds a card to it, so the sheet's height is
   * still settling at the moment the camera has to be aimed. Measuring it
   * then reads a half-rendered panel and aims at the wrong place.
   *
   * Expressed as an offset rather than as flyTo's `padding`, which MapLibre
   * clamps: ask it to reserve most of a phone screen and it quietly reserves
   * far less, leaving the marker behind the panel it was meant to clear.
   */
  private incidentScreenOffset(): [number, number] {
    const centred: [number, number] = [0, 0];
    const sheet = document.querySelector('.ofw-sheet');
    if (!sheet) return centred;

    // Asked as a geometry question rather than as a media query: "is the
    // panel lying across the bottom of the map, or is it a side panel?". A
    // second copy of the breakpoint would drift from the stylesheet that
    // owns it. Width is settled from the moment the panel exists, unlike
    // its height.
    const spansWidth =
      sheet.getBoundingClientRect().width > window.innerWidth * 0.8;
    if (!spansWidth) return centred;

    return [
      0,
      Math.round(window.innerHeight * (INCIDENT_SCREEN_FRACTION - 0.5)),
    ];
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
    this.criticalMarkers.clear();
    this.map?.remove();
  }
}
