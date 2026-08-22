import { Translate } from '@features/conditions/readiness';

import { ZoneForecast } from './data-access/forecast.service';
import { isImminent, outlookText, windowDetail } from './outlook';

const t: Translate = (key, params) =>
  params ? `${key}(${JSON.stringify(params)})` : String(key);

const forecast = (over: Partial<ZoneForecast>): ZoneForecast => ({
  zoneId: 1,
  name: { de: 'Zone', en: 'Zone' },
  hazardType: 'white_phosphorus',
  weatherGated: true,
  windows: [],
  hoursUntilNextWindow: null,
  soilAlreadyDry: false,
  ...over,
});

const window = {
  from: '2026-08-28T12:00',
  to: '2026-08-28T18:00',
  peakTemperatureC: 33.7,
  minSoilMoisturePct: 7.4,
};

describe('outlookText', () => {
  it('says the question does not apply to a detection-gated zone', () => {
    expect(outlookText(forecast({ weatherGated: false }), t, 'de')).toBe(
      'forecastNotWeatherGated',
    );
  });

  it('says so when no window opens in the horizon', () => {
    expect(outlookText(forecast({}), t, 'de')).toBe('forecastNone');
  });

  it('reads the hours straight off the wire rather than re-parsing them', () => {
    // The API sends local wall-clock times with no offset. Parsing them into
    // a Date and formatting again shifted every window by the container's
    // timezone — which is how "13:00" once became "15:00" on the panel.
    const text = outlookText(
      forecast({ windows: [window], hoursUntilNextWindow: 142 }),
      t,
      'de',
    );
    expect(text).toContain('12:00');
    expect(text).toContain('18:00');
    expect(text).toContain('142');
  });

  it('names the weekday in the reader\'s language', () => {
    const german = outlookText(forecast({ windows: [window], hoursUntilNextWindow: 1 }), t, 'de');
    const english = outlookText(forecast({ windows: [window], hoursUntilNextWindow: 1 }), t, 'en');
    expect(german).toContain('Freitag');
    expect(english).toContain('Friday');
  });
});

describe('isImminent', () => {
  it('is true within three days', () => {
    expect(isImminent(forecast({ windows: [window], hoursUntilNextWindow: 71 }))).toBeTrue();
  });

  it('is false beyond them', () => {
    expect(isImminent(forecast({ windows: [window], hoursUntilNextWindow: 73 }))).toBeFalse();
  });

  it('is false with no window at all, whatever the lead time says', () => {
    expect(isImminent(forecast({ hoursUntilNextWindow: 1 }))).toBeFalse();
  });
});

describe('windowDetail', () => {
  it('reports the peak values that make it a window', () => {
    const text = windowDetail(window, t);
    expect(text).toContain('33.7');
    expect(text).toContain('7.4');
  });
});
