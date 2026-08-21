/**
 * The icon set, as path data.
 *
 * Hand-drawn on a 24×24 grid rather than pulled from an icon library: the app
 * needs seven symbols, and every library ships a thousand plus either a webfont
 * to host or a package tree to prune. Keeping them here also means nothing is
 * fetched from a third party at runtime, which is the same rule the rest of the
 * project follows.
 *
 * They replace emoji, which were wrong here for three reasons: they carry
 * their own colours into a palette where red means "alarm" and nothing else
 * may claim it, they render as a different picture on every platform, and a
 * screen reader announces them by name in the middle of a title.
 *
 * Drawn with `currentColor`, so an icon is whatever colour its text is — an
 * alert marker turns red because the alert is critical, and grey when it is
 * not. That is the part an emoji could never do.
 */

export interface IconDefinition {
  /** Path data, drawn in order on a 24×24 viewBox. */
  paths: string[];
  /** Solid shapes fill; the rest are drawn as strokes. */
  filled?: boolean;
}

export const ICONS = {
  /** Warning triangle — a critical alert. */
  alert: {
    paths: ['M12 3.5 22 20.5H2z', 'M12 10v4.5', 'M12 17.6h.01'],
  },

  /** Thermometer — a ground sensor. */
  sensor: {
    paths: [
      'M14 14.8V4.5a2.5 2.5 0 0 0-5 0v10.3a4.5 4.5 0 1 0 5 0z',
      'M11.5 14.2V8',
    ],
  },

  /** Padlock, shackle closed — locking the operator panel. */
  lock: {
    paths: ['M5 11h14v10H5z', 'M8 11V7.5a4 4 0 0 1 8 0V11'],
  },

  /** Battery with terminal — a sensor's remaining charge. */
  battery: {
    paths: ['M2 8h16v8H2z', 'M20 11v2'],
  },

  /** Pencil — the zone and sensor editor. */
  pencil: {
    paths: ['M4 20h4L20 8l-4-4L4 16z', 'M14.5 5.5 18.5 9.5'],
  },

  /**
   * Flame — the evidence behind a smouldering-nest verdict.
   *
   * A teardrop: a point at the top, a half circle at the bottom, and an inner
   * flame echoing it. Constructed from stated coordinates rather than guessed
   * control points, which is how the first attempt ended up drawing a spiral.
   */
  flame: {
    paths: [
      'M12 2.8c3.2 3.6 5 6.1 5 8.9a5 5 0 0 1-10 0c0-2.8 1.8-5.3 5-8.9z',
      'M12 9.5c1.6 1.9 2.5 2.9 2.5 4.2a2.5 2.5 0 0 1-5 0c0-1.3.9-2.3 2.5-4.2z',
    ],
  },

  /** Solid disc — the live status marker in the panel heading. */
  dot: {
    paths: ['M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z'],
    filled: true,
  },
} as const satisfies Record<string, IconDefinition>;

export type IconName = keyof typeof ICONS;

/**
 * Build an icon as a DOM node.
 *
 * MapLibre popups are assembled outside Angular's view tree, so they cannot
 * use the component. Built element by element rather than through innerHTML,
 * like every other piece of markup this app constructs by hand — there is no
 * reason to open an injection surface for a triangle.
 */
export function createIconElement(name: IconName, size = 16): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const definition: IconDefinition = ICONS[name];

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', definition.filled ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', definition.filled ? '0' : '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // Decorative: the adjacent text always says the same thing in words.
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  for (const d of definition.paths) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}
