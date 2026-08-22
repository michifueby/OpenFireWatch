/**
 * The basemaps an operator can switch between.
 *
 * Why this is a list and not a hard-coded pair: what a responder needs to see
 * changes with the question being asked. The dark style keeps the red hazard
 * styling dominant and is right for watching; aerial imagery shows where the
 * tree line, the clearings and the forest tracks actually are, which is what
 * matters once somebody has to drive there; the terrain style shows relief
 * and contours for the same reason.
 *
 * Adding one is a single entry here — nothing else in the map component knows
 * how many there are.
 *
 * All three are RASTER tile sets, deliberately. MapLibre's `setStyle` throws
 * away every source and layer that is not part of the new style, so switching
 * between full styles means rebuilding the hazard overlay — and if that
 * rebuild is ever late or skipped, the operator is looking at a map with no
 * hazard zones on it, which is the worst failure this app has. Keeping one
 * style and only swapping the tiles of its base layer means the overlay is
 * never touched: the switch cannot lose it, because nothing is torn down.
 *
 * ATTRIBUTION IS PART OF THE DEFINITION, not decoration. Each source carries
 * its own licence text, and MapLibre renders whichever belongs to the style
 * currently shown. Removing it would breach the terms these tiles are free
 * under.
 */

import type { StyleSpecification } from 'maplibre-gl';

export type BasemapId = 'dark' | 'aerial' | 'terrain';

export interface Basemap {
  id: BasemapId;
  /** Translation key for the button label. */
  labelKey: 'basemapDark' | 'basemapAerial' | 'basemapTerrain';
  /** Tile URL templates; several hosts let the browser parallelise. */
  tiles: string[];
  /** Licence text. A requirement of every source here, not decoration. */
  attribution: string;
  /**
   * The deepest zoom the source actually serves — VERIFIED against the
   * service, not guessed. Set too high, MapLibre requests tiles that 404 and
   * paints the gaps black instead of stretching the last level it has, which
   * looks like a broken map rather than a limit.
   */
  maxzoom: number;
  /**
   * True when the source only covers Austria. Surfaced in the UI so an
   * operator outside its coverage is not left staring at blank tiles
   * wondering whether the map is broken.
   */
  austriaOnly: boolean;
}

/**
 * basemap.at — the official Austrian basemap, open data under CC BY 4.0.
 * Chosen over the usual commercial imagery because this project monitors
 * Austrian ground: the orthophoto is 30 cm per pixel, which resolves single
 * trees and forest tracks, and the licence is unambiguous.
 */
const BASEMAP_AT_ATTRIBUTION =
  '<a href="https://basemap.at/" target="_blank" rel="noopener">basemap.at</a> (CC BY 4.0)';

/**
 * basemap.at tile URLs. Note the {z}/{y}/{x} order — y before x, unlike most
 * schemes, and silently wrong-looking rather than broken if swapped.
 *
 * Only hosts that actually resolve are listed. The `maps1`–`maps4` shard
 * names that this service is often documented with do NOT exist: every
 * request to them fails, which paints roughly four tiles in five black and
 * looks exactly like a half-loaded map rather than a bad hostname.
 */
const basemapAtTiles = (layer: string, variant: string, ext: string): string[] =>
  ['maps', 'mapsneu'].map(
    (host) =>
      `https://${host}.wien.gv.at/basemap/${layer}/${variant}/google3857/{z}/{y}/{x}.${ext}`,
  );

export const BASEMAPS: readonly Basemap[] = [
  {
    id: 'dark',
    labelKey: 'basemapDark',
    // CartoDB "Dark Matter": the command-centre look the alert styling was
    // designed against, and the only one of the three with global coverage.
    // @2x tiles because everything else on this map is vector-crisp.
    tiles: ['a', 'b', 'c', 'd'].map(
      (host) => `https://${host}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png`,
    ),
    attribution:
      '© <a href="https://carto.com/about-carto/" target="_blank" rel="noopener">CARTO</a>, ' +
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxzoom: 20,
    austriaOnly: false,
  },
  {
    id: 'aerial',
    labelKey: 'basemapAerial',
    tiles: basemapAtTiles('bmaporthofoto30cm', 'normal', 'jpeg'),
    attribution: BASEMAP_AT_ATTRIBUTION,
    maxzoom: 19,
    austriaOnly: true,
  },
  {
    id: 'terrain',
    labelKey: 'basemapTerrain',
    // The grey relief variant rather than the coloured one: the hazard
    // polygons are red, and a green-brown hillshade underneath them costs
    // exactly the contrast the alert styling depends on.
    tiles: basemapAtTiles('bmapgelaende', 'grau', 'jpeg'),
    attribution: BASEMAP_AT_ATTRIBUTION,
    // Shallower than the orthophoto: relief is generalised cartography, and
    // the service stops at 17 where the imagery goes to 19.
    maxzoom: 17,
    austriaOnly: true,
  },
];

/** Source and layer id of the ground everything else is drawn on top of. */
export const BASE_SOURCE = 'basemap';
export const BASE_LAYER = 'basemap-raster';

/**
 * The one style the map ever uses. Switching basemaps replaces this source's
 * tiles in place, so the hazard overlay above it is never rebuilt.
 */
export const buildStyle = (basemap: Basemap): StyleSpecification => ({
  version: 8,
  sources: {
    [BASE_SOURCE]: {
      type: 'raster',
      tiles: [...basemap.tiles],
      tileSize: 256,
      attribution: basemap.attribution,
      maxzoom: basemap.maxzoom,
    },
  },
  layers: [{ id: BASE_LAYER, type: 'raster', source: BASE_SOURCE }],
});

export const DEFAULT_BASEMAP = BASEMAPS[0]!;

/** Persisted so a chosen basemap survives a reload — a preference, not state. */
const STORAGE_KEY = 'ofw-basemap';

export function readStoredBasemap(): Basemap {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return BASEMAPS.find((b) => b.id === stored) ?? DEFAULT_BASEMAP;
  } catch {
    return DEFAULT_BASEMAP; // storage blocked (private mode)
  }
}

export function storeBasemap(id: BasemapId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Preference simply will not survive the reload; nothing else breaks.
  }
}
