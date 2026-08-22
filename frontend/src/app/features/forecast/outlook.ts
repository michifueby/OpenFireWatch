/**
 * The seven-day outlook in one sentence per zone.
 *
 * Separated from the component for the same reason as the readiness wording:
 * it is a rule about how to phrase a forecast, and a test should be able to
 * check it without a browser.
 */

import { Translate } from '@features/conditions/readiness';

import { IgnitionWindow, ZoneForecast } from './data-access/forecast.service';

/** Within three days: close enough to plan around. */
export const IMMINENT_HOURS = 72;

export function isImminent(zone: ZoneForecast): boolean {
  return (
    zone.windows.length > 0 &&
    zone.hoursUntilNextWindow !== null &&
    zone.hoursUntilNextWindow <= IMMINENT_HOURS
  );
}

/**
 * When this zone's ignition window next opens — or why the question does not
 * apply to it at all.
 */
export function outlookText(
  zone: ZoneForecast,
  t: Translate,
  locale: 'de' | 'en',
): string {
  if (!zone.weatherGated) return t('forecastNotWeatherGated');

  const next = zone.windows[0];
  if (!next) return t('forecastNone');

  const day = new Date(next.from).toLocaleDateString(
    locale === 'de' ? 'de-AT' : 'en-GB',
    { weekday: 'long', day: '2-digit', month: '2-digit' },
  );
  const window = t('forecastWindow', {
    day,
    // The API sends local wall-clock times; the hours are already the ones a
    // reader would see on a clock, so they are sliced, not re-parsed.
    from: next.from.slice(11, 16),
    to: next.to.slice(11, 16),
  });
  const lead = t('forecastLeadTime', { hours: zone.hoursUntilNextWindow ?? 0 });
  return `${window} · ${lead}`;
}

/** The peak values inside the window — what makes it a window. */
export function windowDetail(window: IgnitionWindow, t: Translate): string {
  return t('forecastPeak', {
    temp: window.peakTemperatureC,
    soil: window.minSoilMoisturePct,
  });
}
