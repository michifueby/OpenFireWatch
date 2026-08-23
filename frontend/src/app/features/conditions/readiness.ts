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

/**
 * Is the phosphorus ignition window open right now?
 *
 * Not the same as `armed`, and the difference is what keeps the panel
 * readable: a detection-gated zone is ALWAYS armed, so colouring on `armed`
 * would leave such a row permanently red — and a row that is always red
 * teaches the eye to ignore red, which is the one thing this panel cannot
 * afford.
 */
export function isWindowOpen(zone: ZoneReadiness): boolean {
  if (zone.temperatureGapC === undefined && zone.soilMoistureGapPct === undefined) {
    return false;
  }
  return (zone.temperatureGapC ?? 1) <= 0 && (zone.soilMoistureGapPct ?? 1) < 0;
}

/** One of the two weather conditions already satisfied — worth flagging. */
export function isPartiallyMet(zone: ZoneReadiness): boolean {
  // Applies wherever a window is tracked, whichever gate escalates.
  if (zone.temperatureGapC === undefined && zone.soilMoistureGapPct === undefined) {
    return false;
  }
  return (zone.temperatureGapC ?? 1) <= 0 || (zone.soilMoistureGapPct ?? 1) < 0;
}

/**
 * Whether this zone would escalate right now, and if not, how far the
 * conditions still are from its threshold.
 */
export function readinessText(zone: ZoneReadiness, t: Translate): string {
  if (zone.gate === 'detection') {
    // A forest with phosphorus in the ground carries both hazards: it alarms
    // on any detection AND has an ignition window worth watching. Saying only
    // the first would hide the number the ground sensors exist to measure.
    if (zone.temperatureGapC === undefined && zone.soilMoistureGapPct === undefined) {
      return t('conditionsOnDetection');
    }
    const windowOpen =
      (zone.temperatureGapC ?? 1) <= 0 && (zone.soilMoistureGapPct ?? 1) < 0;
    return windowOpen
      ? t('conditionsDetectionWindowOpen')
      : t('conditionsDetectionWindowGap', { gap: gapPhrase(zone, t) });
  }
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

/** The distance to the window, without the sentence around it. */
function gapPhrase(zone: ZoneReadiness, t: Translate): string {
  const tempMet = (zone.temperatureGapC ?? 1) <= 0;
  const soilMet = (zone.soilMoistureGapPct ?? 1) < 0;
  if (soilMet && !tempMet) {
    return t('gapTempOnlyShort', { temp: formatGap(zone.temperatureGapC) });
  }
  if (tempMet && !soilMet) {
    return t('gapSoilOnlyShort', { soil: formatGap(zone.soilMoistureGapPct) });
  }
  return t('gapBothShort', {
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
