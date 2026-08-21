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

import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  signal,
} from '@angular/core';
import maplibregl, { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { Subscription } from 'rxjs';

import {
  Basemap,
  BASEMAPS,
  BASE_LAYER,
  BASE_SOURCE,
  buildStyle,
  readStoredBasemap,
  storeBasemap,
} from './basemaps';

import { TranslationService } from '../core/i18n/translation.service';
import { ConditionsService } from '../core/services/conditions.service';
import { SensorApiService, SensorInfo } from '../sensors/sensor-api.service';
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
const SENSORS_SOURCE = 'ground-sensors';
const SENSORS_LAYER = 'ground-sensors-dots';

/** Feature properties carried by the sensor layer (MapLibre re-parses JSON). */
interface SensorPopupProps {
  label: string;
  deviceId: string;
  reporting: boolean;
  temperatureC: number | null;
  soilMoisturePct: number | null;
  batteryPct: number | null;
}

@Component({
  selector: 'ofw-map',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div #mapContainer class="map"></div>

    <!-- Basemap switcher. Bottom-left on a desktop, where it is out of the
         way of both panels; the phone layout moves it (see the styles). -->
    <div class="basemaps" role="group" [attr.aria-label]="i18n.t('basemapAria')">
      <button
        *ngFor="let option of basemaps"
        type="button"
        [class.active]="option.id === basemap().id"
        [attr.aria-pressed]="option.id === basemap().id"
        [attr.title]="
          option.austriaOnly ? i18n.t('basemapAustriaOnly') : null
        "
        (click)="selectBasemap(option)"
      >
        {{ i18n.t(option.labelKey) }}
        <!-- Coverage is a property of the source, not a detail: outside
             Austria these tiles are simply blank, and an operator should
             learn that from the button rather than from an empty map. -->
        <span class="coverage" *ngIf="option.austriaOnly" aria-hidden="true">AT</span>
      </button>
    </div>
  `,
  styles: [
    `
      .basemaps {
        position: fixed;
        z-index: 3;
        left: 1rem;
        bottom: 4.25rem; // clear of the credit bar
        display: flex;
        gap: 1px;
        padding: 1px;
        border: 1px solid rgba(230, 232, 238, 0.26);
        border-radius: 999px;
        background: rgba(7, 12, 20, 0.88);
        backdrop-filter: blur(6px);
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5);
        overflow: hidden;

        button {
          min-height: 2rem;
          padding: 0.35rem 0.8rem;
          border: none;
          border-radius: 999px;
          background: transparent;
          color: #97a1b3;
          font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
          font-size: 0.72rem;
          letter-spacing: 0.06em;
          cursor: pointer;

          &:hover {
            color: #e6e8ee;
          }

          // The active basemap is stated, not implied by a subtle tint:
          // which ground you are looking at changes how you read everything
          // drawn on top of it.
          &.active {
            background: rgba(230, 232, 238, 0.14);
            color: #e6e8ee;
          }

          .coverage {
            margin-left: 0.3rem;
            padding: 0.05rem 0.25rem;
            border-radius: 3px;
            background: rgba(230, 232, 238, 0.12);
            font-size: 0.6rem;
            letter-spacing: 0.04em;
            vertical-align: 1px;
          }
        }
      }

      // Phone: the bottom-left corner belongs to the situation sheet, so the
      // switcher moves up beside the top-left launcher instead.
      @media (max-width: 640px) {
        .basemaps {
          left: calc(0.75rem + var(--ofw-safe-left));
          // Clear of the launcher above it, which ends around 3.25rem.
          top: calc(4.25rem + var(--ofw-safe-top));
          bottom: auto;
          // Never wider than the screen: three labels plus coverage chips is
          // a lot of horizontal text for 375 px.
          max-width: calc(100vw - 1.5rem - var(--ofw-safe-left) - var(--ofw-safe-right));

          button {
            min-height: 2.25rem;
            padding: 0.4rem 0.6rem;
            font-size: 0.68rem;
            white-space: nowrap;

            .coverage {
              margin-left: 0.25rem;
              padding: 0.05rem 0.2rem;
              font-size: 0.56rem;
            }
          }
        }
      }

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

  /** Layer-scoped handlers outlive their layer; bind them exactly once. */
  private sensorHandlersBound = false;

  readonly basemaps = BASEMAPS;
  /** The basemap on screen; restored from the operator's last choice. */
  readonly basemap = signal<Basemap>(readStoredBasemap());

  constructor(
    private readonly alerts: RealTimeAlertService,
    readonly i18n: TranslationService,
    private readonly draw: ZoneDrawService,
    private readonly zoneApi: ZoneApiService,
    private readonly sensorApi: SensorApiService,
    private readonly conditions: ConditionsService,
  ) {
    // Re-draw the overlay whenever the editor writes a zone. Guarded inside
    // loadRiskZones(), so firing before the map is ready is harmless.
    effect(() => {
      this.zoneApi.revision();
      void this.loadRiskZones();
    });

    // A sensor placed or moved in the editor appears immediately; and the
    // conditions poll doubles as a refresh tick, so reporting-state dots and
    // measured values stay honest without their own timer.
    effect(() => {
      this.sensorApi.revision();
      this.conditions.conditions();
      void this.loadSensors();
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
      style: buildStyle(this.basemap()),
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

    // A tab that loads in the background can measure the container at 0×0
    // (dvh resolves to 0 until the viewport is realised), leaving MapLibre on
    // its tiny fallback canvas. Re-measure the moment we become visible.
    document.addEventListener('visibilitychange', this.onVisible);

    // Automated tests (and a developer on the console) can reach the map
    // and the draw service through ?debug=1. Read-only exposure: every write
    // path still carries the operator key, so this reveals nothing that the
    // public API does not.
    if (new URLSearchParams(location.search).has('debug')) {
      (window as unknown as Record<string, unknown>)['__ofw'] = {
        map: this.map,
        draw: this.draw,
      };
    }

    // `styledata` rather than `load`: `load` waits for the base map's TILES,
    // and a raster basemap whose tiles are slow (or never arrive, on a
    // throttled tab) would leave the hazard overlay uninstalled — a map
    // showing ground with no zones on it, which is this app's worst failure.
    // `styledata` fires as soon as the style itself is usable, which is all
    // addSource needs. installOverlay is idempotent, so the repeat firings
    // this event is known for cost nothing.
    this.map.on('styledata', () => this.installOverlay());
  }

  /**
   * Switch the ground underneath the hazard overlay.
   *
   * `setStyle` throws away every source and layer that is not part of the new
   * style, so everything this component drew has to be reinstalled — that is
   * what the `styledata` handler above is for. The camera position is kept:
   * an operator switching to aerial imagery is asking "what does THIS look
   * like", and moving the view would answer a different question.
   */
  selectBasemap(option: Basemap): void {
    if (option.id === this.basemap().id) return;
    this.basemap.set(option);
    storeBasemap(option.id);

    // Swap the ground, keep everything drawn on it. `setStyle` would discard
    // the hazard zones, sensors and detections and require rebuilding them
    // on a style event; this touches one source and cannot lose anything.
    // Replace the base source outright rather than calling setTiles: that
    // swaps the imagery but re-applies the source's ORIGINAL attribution,
    // which would leave CARTO's credit standing under basemap.at aerial
    // photography. These tiles are free precisely on condition of correct
    // credit, so the attribution has to travel with them.
    const style = buildStyle(option);
    // Insert the new base below the first overlay layer, so the hazard zones,
    // sensors and detections keep painting on top of the ground rather than
    // disappearing beneath it.
    const firstOverlayLayer = this.map
      .getStyle()
      .layers.find((layer) => layer.id !== BASE_LAYER)?.id;

    if (this.map.getLayer(BASE_LAYER)) this.map.removeLayer(BASE_LAYER);
    if (this.map.getSource(BASE_SOURCE)) this.map.removeSource(BASE_SOURCE);
    this.map.addSource(BASE_SOURCE, style.sources[BASE_SOURCE]);
    this.map.addLayer(style.layers[0], firstOverlayLayer);
  }

  /**
   * (Re)build everything this component draws on top of the basemap.
   * Idempotent by construction: called on first load and after every style
   * change, and each step adds a source that the style itself never carries.
   */
  private installOverlay(): void {
    // Every source below is added together, so one is enough to tell whether
    // this already ran — which makes a duplicate event harmless instead of
    // an "source already exists" throw that would abort the rebuild.
    if (this.map.getSource(RISK_ZONE_SOURCE)) return;

    this.drawRiskZones();
    this.initSensorLayer();
    this.initAnomalyLayer();
    // Drawing layers are registered last so the draft paints on top.
    this.draw.attach(this.map);
    void this.loadRiskZones();
    void this.loadSensors();
    void this.loadAnomalyHistory();
    // Anything that streamed in while the style was loading is already
    // collected; this is the first moment it can be painted.
    this.refreshAnomalySource();
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

  /**
   * Ground sensors as small teal dots — green-ish while reporting, grey once
   * silent. Registered before the anomaly layer so detections paint above
   * them: a sensor is context, a detection is the event.
   */
  private initSensorLayer(): void {
    this.map.addSource(SENSORS_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    this.map.addLayer({
      id: SENSORS_LAYER,
      type: 'circle',
      source: SENSORS_SOURCE,
      paint: {
        'circle-radius': 5,
        'circle-color': [
          'case',
          ['get', 'reporting'],
          '#2dd4bf', // fresh data
          '#5b6678', // silent — the dot itself is the maintenance signal
        ],
        'circle-stroke-color': '#05070c',
        'circle-stroke-width': 1.5,
      },
    });

    if (this.sensorHandlersBound) return;
    this.sensorHandlersBound = true;

    this.map.on('click', SENSORS_LAYER, (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      new maplibregl.Popup({ offset: 10 })
        .setLngLat(event.lngLat)
        .setDOMContent(this.buildSensorPopup(feature.properties as SensorPopupProps))
        .addTo(this.map);
    });
    this.map.on('mouseenter', SENSORS_LAYER, () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', SENSORS_LAYER, () => {
      this.map.getCanvas().style.cursor = '';
    });
  }

  /** Fetch the registry and mirror it onto the sensor layer. */
  private async loadSensors(): Promise<void> {
    const source = this.map?.getSource(SENSORS_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    try {
      const sensors = (await (await fetch('/api/sensors')).json()) as SensorInfo[];
      source.setData({
        type: 'FeatureCollection',
        features: sensors.map((sensor) => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [sensor.longitude, sensor.latitude],
          },
          properties: {
            label: sensor.label,
            deviceId: sensor.deviceId,
            reporting: sensor.reporting,
            temperatureC: sensor.temperatureC,
            soilMoisturePct: sensor.soilMoisturePct,
            batteryPct: sensor.batteryPct,
          },
        })),
      });
    } catch {
      // The map stays usable without the sensor overlay.
    }
  }

  /** Sensor popup, DOM-built like the alert popup (no injection surface). */
  private buildSensorPopup(props: SensorPopupProps): HTMLElement {
    const container = document.createElement('div');
    container.className = 'ofw-popup';

    const title = document.createElement('strong');
    title.textContent = `🌡 ${props.label}`;
    container.appendChild(title);

    const lines = [
      props.deviceId,
      props.temperatureC != null
        ? `${this.i18n.t('conditionsTemp')}: ${props.temperatureC} °C`
        : null,
      props.soilMoisturePct != null
        ? `${this.i18n.t('conditionsSoil')}: ${props.soilMoisturePct} %`
        : null,
      props.batteryPct != null
        ? `${this.i18n.t('sensorBattery')}: ${props.batteryPct} %`
        : null,
      this.i18n.t(props.reporting ? 'sensorReporting' : 'sensorStale'),
    ];
    for (const text of lines) {
      if (!text) continue;
      const row = document.createElement('div');
      row.textContent = text;
      container.appendChild(row);
    }
    return container;
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

  private readonly onVisible = (): void => {
    if (!document.hidden) this.map?.resize();
  };

  /** Leak-free teardown: streams, markers, then the WebGL map itself. */
  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisible);
    this.draw.detach();
    this.subscriptions.unsubscribe();
    this.criticalMarkers.forEach((marker) => marker.remove());
    this.criticalMarkers.clear();
    this.map?.remove();
  }
}
