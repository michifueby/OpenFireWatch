/**
 * How to say, in one line, whether a zone would escalate right now.
 *
 * Plain functions rather than component methods because two very different
 * places need the same answer: the conditions list, and the one-line summary
 * on the collapsed mobile sheet. When the wording lived on the dashboard,
 * the summary reached across to call it — and a rule that two screens must
 * agree on should not belong to either of them.
 *
 * They take a `translate` function rather than the service so a test can
 * check the wording without booting Angular.
 */

import { TranslationDict } from '@core/i18n/translations';

import { ZoneReadiness } from './data-access/conditions.service';

export type Translate = (
  key: keyof TranslationDict,
  params?: Readonly<Record<string, unknown>>,
) => string;

/** One of the two weather conditions already satisfied — worth flagging. */
export function isPartiallyMet(zone: ZoneReadiness): boolean {
  if (zone.gate !== 'weather') return false;
  return (zone.temperatureGapC ?? 1) <= 0 || (zone.soilMoistureGapPct ?? 1) < 0;
}

/**
 * Whether this zone would escalate right now, and if not, how far the
 * conditions still are from its threshold.
 */
export function readinessText(zone: ZoneReadiness, t: Translate): string {
  if (zone.gate === 'detection') return t('conditionsOnDetection');
  if (zone.armed) return t('conditionsArmed');

  // Which of the two conditions is already satisfied matters: "one hot
  // afternoon away" is a very different situation from "nowhere near", and
  // reporting a clamped 0 for an already-crossed threshold hid exactly that.
  const tempMet = (zone.temperatureGapC ?? 1) <= 0;
  const soilMet = (zone.soilMoistureGapPct ?? 1) < 0;

  if (soilMet && !tempMet) {
    return t('conditionsGapTempOnly', { temp: formatGap(zone.temperatureGapC) });
  }
  if (tempMet && !soilMet) {
    return t('conditionsGapSoilOnly', { soil: formatGap(zone.soilMoistureGapPct) });
  }
  return t('conditionsGap', {
    temp: formatGap(zone.temperatureGapC),
    soil: formatGap(zone.soilMoistureGapPct),
  });
}

/**
 * Degrees → the eight compass points a person actually reasons in.
 *
 * DD states where the wind comes FROM, which is also what a fire-spread
 * question needs: smoke and spread run the opposite way.
 */
export function windFrom(degrees: number, t: Translate, german: boolean): string {
  const points = german
    ? ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW']
    : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return t('windFrom', { dir: points[index]! });
}

/** A crossed threshold reads as 0 rather than a confusing negative distance. */
function formatGap(value: number | undefined): string {
  if (value === undefined) return '?';
  return String(Math.max(0, Math.round(value * 10) / 10));
}
