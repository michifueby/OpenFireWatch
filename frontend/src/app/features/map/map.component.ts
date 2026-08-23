/**
 * MapComponent — the situational-awareness map for emergency responders.
 *
 * What this class owns is the MAP: the WebGL instance, the ground underneath
 * it, the camera, and when each overlay is (re)installed. What each overlay
 * IS — the hazard polygons, the ground sensors, the detections, the pulsing
 * markers — belongs to the overlay objects in ./overlays, one per thing drawn.
 *
 * Splitting it that way is not tidiness for its own sake. Every overlay has
 * the same three-part life — register a source, register layers, load data —
 * and every one of them has to survive a basemap change, because `setStyle`
 * discards every source and layer that is not part of the new style. Keeping
 * the three parts of each overlay in one object is what makes "reinstall
 * everything" a loop over four collaborators instead of four hundred lines
 * with a shared `this`.
 *
 * Memory-leak hygiene: the RxJS subscriptions, every Marker, and the map
 * instance itself are torn down in ngOnDestroy — MapLibre holds WebGL
 * contexts and DOM listeners that survive component destruction unless
 * `map.remove()` is called explicitly.
 */

import { DatePipe } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import { Subscription } from 'rxjs';

import { TranslationService } from '@core/i18n/translation.service';
import { AnomalyAlert } from '@core/models/alert.model';
import { RealTimeAlertService } from '@features/alerts/data-access/real-time-alert.service';
import { ConditionsService } from '@features/conditions/data-access/conditions.service';
import { SensorApiService } from '@features/sensors/data-access/sensor-api.service';
import { ZoneApiService } from '@features/zones/data-access/zone-api.service';
import { ZoneDrawService } from '@features/zones/data-access/zone-draw.service';

import {
  Basemap,
  BASEMAPS,
  BASE_LAYER,
  BASE_SOURCE,
  buildStyle,
  readStoredBasemap,
  storeBasemap,
} from './basemaps';
import { AnomalyOverlay } from './overlays/anomaly.overlay';
import { CriticalMarkers } from './overlays/critical-markers';
import { RiskZoneOverlay } from './overlays/risk-zone.overlay';
import { SensorOverlay } from './overlays/sensor.overlay';

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

@Component({
  selector: 'ofw-map',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './map.component.html',
  styleUrl: './map.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: true })
  private readonly mapContainer!: ElementRef<HTMLDivElement>;

  readonly i18n = inject(TranslationService);
  private readonly alerts = inject(RealTimeAlertService);
  private readonly draw = inject(ZoneDrawService);
  private readonly zoneApi = inject(ZoneApiService);
  private readonly sensorApi = inject(SensorApiService);
  private readonly conditions = inject(ConditionsService);

  private readonly riskZones = inject(RiskZoneOverlay);
  private readonly sensors = inject(SensorOverlay);
  private readonly anomalies = inject(AnomalyOverlay);
  private readonly markers = inject(CriticalMarkers);

  private map!: MapLibreMap;
  private readonly subscriptions = new Subscription();
  /** Zone ids the overlay currently reflects, to detect changes cheaply. */
  private knownZoneIds = '';

  readonly basemaps = BASEMAPS;

  /**
   * The day being shown, or null for the live view.
   *
   * Time travel is a deliberate MODE, not a filter: while a past day is on
   * screen the pulsing markers come off, because those mirror what is
   * outstanding RIGHT NOW and would claim that a fire from 2021 still needs
   * somebody. The camera stops chasing new alerts for the same reason.
   */
  readonly viewedDay = signal<string | null>(null);
  /** How many detections that day holds — so an empty map can say why. */
  readonly viewedDayCount = signal<number | null>(null);
  readonly dayLoading = signal(false);
  /** Today, in the local calendar, as the date input's upper bound. */
  readonly today = new Date().toLocaleDateString('sv-SE');
  /** The basemap on screen; restored from the operator's last choice. */
  readonly basemap = signal<Basemap>(readStoredBasemap());

  constructor() {
    // Re-draw the overlay whenever the editor writes a zone. Guarded inside
    // the overlay, so firing before the map is ready is harmless.
    effect(() => {
      this.zoneApi.revision();
      void this.riskZones.load();
    });

    // A sensor placed or moved in the editor appears immediately; and the
    // conditions poll doubles as a refresh tick, so reporting-state dots and
    // measured values stay honest without their own timer.
    effect(() => {
      this.sensorApi.revision();
      this.conditions.conditions();
      void this.sensors.load();
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
        void this.riskZones.load();
      }
    });

    // Markers reflect what IS outstanding, so an effect. The camera below
    // stays a subscription, because it must react to an alert ARRIVING and
    // not to the fact that one exists.
    //
    // Suspended while a past day is on screen: a pulsing marker means "this
    // needs somebody now", and nothing on 14 August 2021 does.
    effect(() => {
      const warnings = this.alerts.activeWarnings();
      if (this.viewedDay()) return;
      this.markers.sync(warnings);
    });
  }

  /** Show one past day. Empty string or null returns to the live view. */
  async viewDay(day: string | null): Promise<void> {
    this.dayLoading.set(true);
    try {
      if (!day) {
        this.viewedDay.set(null);
        this.viewedDayCount.set(null);
        await this.anomalies.showLive();
        // The markers describe what is outstanding now, so they come back
        // with the live view.
        this.markers.sync(this.alerts.activeWarnings());
        return;
      }

      const count = await this.anomalies.showDay(day);
      this.viewedDay.set(day);
      this.viewedDayCount.set(count);
      this.markers.clear();
    } catch {
      // A failed lookup must not strand the map in a half-changed state.
      this.viewedDayCount.set(null);
    } finally {
      this.dayLoading.set(false);
    }
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
    this.markers.attach(this.map);

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

    // Automated tests (and a developer on the console) can reach the map and
    // the draw service through ?debug=1. Read-only exposure: every write path
    // still carries the operator key, so this reveals nothing that the public
    // API does not.
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
    // addSource needs. installOverlays is idempotent, so the repeat firings
    // this event is known for cost nothing.
    this.map.on('styledata', () => this.installOverlays());
  }

  /**
   * Switch the ground underneath the hazard overlay.
   *
   * The camera position is kept: an operator switching to aerial imagery is
   * asking "what does THIS look like", and moving the view would answer a
   * different question.
   */
  selectBasemap(option: Basemap): void {
    if (option.id === this.basemap().id) return;
    this.basemap.set(option);
    storeBasemap(option.id);

    // Swap the ground, keep everything drawn on it. `setStyle` would discard
    // the hazard zones, sensors and detections and require rebuilding them on
    // a style event; this touches one source and cannot lose anything.
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
   * (Re)build everything drawn on top of the basemap, in paint order:
   * zones, then sensors, then detections, then the drawing layers on top.
   */
  private installOverlays(): void {
    // Every source below is added together, so one is enough to tell whether
    // this already ran — which makes a duplicate event harmless instead of a
    // "source already exists" throw that would abort the rebuild.
    if (this.map.getSource(RiskZoneOverlay.SOURCE)) return;

    this.riskZones.install(this.map);
    this.sensors.install(this.map);
    this.anomalies.install(this.map);
    // Drawing layers are registered last so the draft paints on top.
    this.draw.attach(this.map);

    void this.riskZones.load();
    void this.sensors.load();
    void this.anomalies.loadHistory();
    // Anything that streamed in while the style was loading is already
    // collected; this is the first moment it can be painted.
    this.anomalies.repaint();
  }

  private subscribeToRealtimeAlerts(): void {
    this.subscriptions.add(
      this.alerts.anomalies$.subscribe((alert) => {
        // A live detection has no place on a map showing a past day.
        if (!this.viewedDay()) this.anomalies.add(alert);
      }),
    );

    // The camera reacts to news, not to state: flying on the warning list
    // would yank the view somewhere every time the history is restored or an
    // unrelated alarm is acknowledged.
    this.subscriptions.add(
      this.alerts.criticalAlerts$.subscribe((alert) => {
        if (!this.viewedDay()) this.flyToIncident(alert);
      }),
    );
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
    // second copy of the breakpoint would drift from the stylesheet that owns
    // it. Width is settled from the moment the panel exists, unlike its
    // height.
    const spansWidth =
      sheet.getBoundingClientRect().width > window.innerWidth * 0.8;
    if (!spansWidth) return centred;

    return [0, Math.round(window.innerHeight * (INCIDENT_SCREEN_FRACTION - 0.5))];
  }

  private readonly onVisible = (): void => {
    if (!document.hidden) this.map?.resize();
  };

  /** Leak-free teardown: streams, markers, then the WebGL map itself. */
  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisible);
    this.draw.detach();
    this.subscriptions.unsubscribe();
    this.markers.clear();
    this.map?.remove();
  }
}
