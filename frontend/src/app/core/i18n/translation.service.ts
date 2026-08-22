/**
 * TranslationService — lightweight runtime i18n (English + German).
 *
 * Locale resolution order:
 *   1. an explicit choice the user made earlier (persisted in localStorage),
 *   2. the BROWSER LANGUAGE (`navigator.language`): any "de*" → German,
 *   3. English as the fallback.
 *
 * The active locale is an Angular signal, so every `t(...)` call made from a
 * template re-evaluates automatically when the language changes — no page
 * reload, no per-locale build. For a two-language tactical UI this beats
 * Angular's build-time i18n (which produces one bundle per locale and cannot
 * follow the browser language at runtime from a single deployment).
 */

import { effect, Injectable, signal } from '@angular/core';

import { Locale, TranslationDict, TRANSLATIONS } from './translations';

const STORAGE_KEY = 'ofw-locale';

/** Alert level (as sent by the backend) -> translation key. */
const LEVEL_LABEL_KEYS: Record<string, keyof TranslationDict> = {
  ELEVATED: 'levelElevated',
  CRITICAL_PHOSPHORUS_FIRE: 'levelPhosphorusFire',
  CRITICAL_WILDFIRE: 'levelWildfire',
  CRITICAL_ORDNANCE_HEAT: 'levelOrdnanceHeat',
  CRITICAL_THERMAL_ANOMALY: 'levelThermalAnomaly',
  CRITICAL_SMOULDERING: 'levelSmouldering',
  CRITICAL_SENSOR_HEAT: 'levelSensorHeat',
};

@Injectable({ providedIn: 'root' })
export class TranslationService {
  /** The active locale — a signal, so templates react to changes. */
  readonly locale = signal<Locale>(resolveInitialLocale());

  constructor() {
    // Keep document metadata in sync with the active language.
    effect(() => {
      const active = this.locale();
      document.documentElement.lang = active;
      document.title = TRANSLATIONS[active].appTitle;
    });
  }

  /**
   * Translate a key in the active locale (typed: unknown keys don't compile).
   *
   * Placeholders are filled by name: `t('seasonDays', { days: 18 })` turns
   * "an {days} Tagen" into "an 18 Tagen". Twenty-two call sites used to chain
   * `.replace('{days}', String(...))` by hand, which silently produced a
   * sentence with a literal `{days}` in it whenever a name was mistyped —
   * and produced it in front of whoever was reading the panel.
   */
  t(key: keyof TranslationDict, params?: Readonly<Record<string, unknown>>): string {
    const text = TRANSLATIONS[this.locale()][key];
    return params ? fill(text, params) : text;
  }

  /**
   * Pick the active language out of a per-locale map.
   *
   * Used for values that come from the BACKEND rather than the translation
   * dictionaries — e.g. risk-zone names, which are operator data and ship in
   * every language inside the alert payload.
   */
  pick(values: Record<Locale, string>): string {
    return values[this.locale()];
  }

  /**
   * Human label for an alert level in the active language.
   *
   * Lives here rather than in each component so the dashboard, the map marker
   * and the popup can never disagree about what a level is called.
   */
  levelLabel(level: string): string {
    const key = LEVEL_LABEL_KEYS[level];
    return key ? this.t(key) : level;
  }

  /** Explicit user choice — wins over browser detection and is persisted. */
  setLocale(locale: Locale): void {
    this.locale.set(locale);
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Storage can be unavailable (private mode) — detection still works.
    }
  }
}

/** Persisted choice → browser language → English. */
function resolveInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'de' || stored === 'en') return stored;
  } catch {
    /* storage unavailable — fall through to browser detection */
  }

  const browserLanguages =
    typeof navigator !== 'undefined'
      ? (navigator.languages ?? [navigator.language])
      : [];
  return browserLanguages.some((lang) => lang?.toLowerCase().startsWith('de'))
    ? 'de'
    : 'en';
}

/**
 * Replace every `{name}` for which a value was supplied.
 *
 * An unknown placeholder is left standing rather than blanked: a visible
 * `{days}` is a bug report from the panel itself, while an empty gap reads
 * as a missing measurement.
 */
function fill(text: string, params: Readonly<Record<string, unknown>>): string {
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  );
}
