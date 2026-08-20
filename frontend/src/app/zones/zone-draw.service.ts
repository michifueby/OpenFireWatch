/**
 * ZoneDrawService — polygon drawing directly on the MapLibre map.
 *
 * Deliberately hand-rolled rather than pulling in a drawing library: the
 * requirement is "click a few corners and close the ring", which is ~100
 * lines against MapLibre's own GeoJSON sources. A general-purpose editing
 * library would add a dependency, bundle weight and a version-compatibility
 * surface for a fraction of its features.
 *
 * Interaction (kept conventional so it needs no explanation):
 *   click        place a corner
 *   move         rubber-band preview to the cursor
 *   double-click finish
 *   Enter        finish · Backspace undo last corner · Escape cancel
 */

import { Injectable, signal } from '@angular/core';
import type {
  GeoJSONSource,
  MapMouseEvent,
  Map as MapLibreMap,
} from 'maplibre-gl';

const DRAFT_SOURCE = 'zone-draft';
/** A polygon needs three distinct corners before it encloses anything. */
const MIN_CORNERS = 3;

type Position = [number, number];

@Injectable({ providedIn: 'root' })
export class ZoneDrawService {
  /** Corners placed so far — a signal so the panel can react live. */
  readonly corners = signal<Position[]>([]);
  /** Whether drawing mode is currently active. */
  readonly drawing = signal(false);
  /** Set when the map's double-click gesture completes an outline. */
  readonly completed = signal<GeoJSON.Polygon | null>(null);

  private map?: MapLibreMap;
  private cursor: Position | null = null;
  private keyHandler?: (event: KeyboardEvent) => void;

  /** Called once by MapComponent when the map style has loaded. */
  attach(map: MapLibreMap): void {
    this.map = map;

    map.addSource(DRAFT_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    // Added last → painted above the zone and anomaly layers.
    map.addLayer({
      id: 'zone-draft-fill',
      type: 'fill',
      source: DRAFT_SOURCE,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#ffd166', 'fill-opacity': 0.2 },
    });
    map.addLayer({
      id: 'zone-draft-line',
      type: 'line',
      source: DRAFT_SOURCE,
      filter: ['!=', ['geometry-type'], 'Point'],
      paint: { 'line-color': '#ffd166', 'line-width': 2, 'line-dasharray': [2, 1] },
    });
    map.addLayer({
      id: 'zone-draft-points',
      type: 'circle',
      source: DRAFT_SOURCE,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 5,
        'circle-color': '#ffd166',
        'circle-stroke-color': '#05070c',
        'circle-stroke-width': 2,
      },
    });

    map.on('click', this.onClick);
    map.on('mousemove', this.onMouseMove);
    map.on('dblclick', this.onDoubleClick);
  }

  /** Enter drawing mode, optionally seeding it with an existing outline. */
  start(seed?: Position[]): void {
    this.completed.set(null);
    this.corners.set(seed ? [...seed] : []);
    this.cursor = null;
    this.drawing.set(true);
    if (this.map) {
      this.map.getCanvas().style.cursor = 'crosshair';
      // Otherwise the finishing double-click would also zoom the map.
      this.map.doubleClickZoom.disable();
    }
    this.keyHandler = (event: KeyboardEvent) => {
      if (!this.drawing()) return;
      if (event.key === 'Escape') this.cancel();
      else if (event.key === 'Enter') this.finish();
      else if (event.key === 'Backspace') {
        event.preventDefault();
        this.undo();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
    this.render();
  }

  /** Remove the most recently placed corner. */
  undo(): void {
    this.corners.update((c) => c.slice(0, -1));
    this.render();
  }

  /** Leave drawing mode, discarding the draft. */
  cancel(): void {
    this.corners.set([]);
    this.stop();
  }

  /**
   * Close the ring and return it as a GeoJSON Polygon, or null if there are
   * too few corners. The first position is repeated at the end, as the
   * GeoJSON spec requires.
   */
  finish(): GeoJSON.Polygon | null {
    const corners = this.corners();
    if (corners.length < MIN_CORNERS) return null;
    this.stop();
    const first = corners[0]!;
    return { type: 'Polygon', coordinates: [[...corners, first]] };
  }

  /** Release map handlers; safe to call when never attached. */
  detach(): void {
    this.stop();
    this.map?.off('click', this.onClick);
    this.map?.off('mousemove', this.onMouseMove);
    this.map?.off('dblclick', this.onDoubleClick);
    this.map = undefined;
  }

  private stop(): void {
    this.drawing.set(false);
    this.cursor = null;
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = undefined;
    }
    if (this.map) {
      this.map.getCanvas().style.cursor = '';
      this.map.doubleClickZoom.enable();
    }
    this.render();
  }

  private readonly onClick = (event: MapMouseEvent): void => {
    if (!this.drawing()) return;
    const { lng, lat } = event.lngLat;
    this.corners.update((c) => [...c, [round6(lng), round6(lat)]]);
    this.render();
  };

  private readonly onMouseMove = (event: MapMouseEvent): void => {
    if (!this.drawing() || this.corners().length === 0) return;
    this.cursor = [event.lngLat.lng, event.lngLat.lat];
    this.render();
  };

  private readonly onDoubleClick = (): void => {
    if (this.drawing() && this.corners().length >= MIN_CORNERS) {
      // Emitted rather than returned: the gesture originates on the map, but
      // the editor panel owns what happens with the finished outline.
      this.completed.set(this.finish());
    }
  };

  /** Repaint the draft: filled ring once closable, otherwise a line. */
  private render(): void {
    const source = this.map?.getSource(DRAFT_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;

    const corners = this.drawing() ? this.corners() : [];
    const features: GeoJSON.Feature[] = corners.map((position) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: position },
    }));

    const path = this.cursor ? [...corners, this.cursor] : corners;
    if (path.length >= MIN_CORNERS) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [[...path, path[0]!]] },
      });
    } else if (path.length === 2) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: path },
      });
    }

    source.setData({ type: 'FeatureCollection', features });
  }
}

/** ~10 cm precision — plenty for a hazard boundary, keeps payloads small. */
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
