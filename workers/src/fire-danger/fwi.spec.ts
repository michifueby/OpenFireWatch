/**
 * The FWI equations, pinned to the published worked example.
 *
 * Van Wagner & Pickett (1985) give one day of input and the six outputs the
 * system must produce from it; every reference implementation (the Canadian
 * Forest Service's own, cffdrs, the European ones) reproduces these figures.
 * If any equation here drifts by a constant, this is where it shows.
 */

import {
  DANGER_CLASS_LOWER_BOUNDS,
  INITIAL_CODES,
  buildupIndex,
  classify,
  computeFireWeatherSeries,
  dailyInputsFromHourly,
  droughtCode,
  duffMoistureCode,
  fineFuelMoistureCode,
  fireWeatherIndex,
  initialSpreadIndex,
  stepFireWeather,
} from './fwi';

/** 13 April: 17 °C, 42 % RH, 25 km/h, no rain, starting from the standard codes. */
const REFERENCE_DAY = {
  date: '1985-04-13',
  month: 4,
  temperatureC: 17,
  relativeHumidityPct: 42,
  windSpeedKmh: 25,
  rain24hMm: 0,
};

describe('the published worked example', () => {
  const day = stepFireWeather(INITIAL_CODES, REFERENCE_DAY);

  it('reproduces FFMC 87.69', () => expect(day.ffmc).toBeCloseTo(87.693, 2));
  it('reproduces DMC 8.55', () => expect(day.dmc).toBeCloseTo(8.545, 2));
  it('reproduces DC 19.01', () => expect(day.dc).toBeCloseTo(19.014, 2));
  it('reproduces ISI 10.85', () => expect(day.isi).toBeCloseTo(10.854, 2));
  it('reproduces BUI 8.49', () => expect(day.bui).toBeCloseTo(8.490, 2));
  it('reproduces FWI 10.10', () => expect(day.fwi).toBeCloseTo(10.096, 2));
  it('which EFFIS calls "low"', () => expect(day.dangerClass).toBe('low'));
});

describe('the moisture codes behave like moisture', () => {
  it('rain lowers the FFMC, drying raises it', () => {
    const dry = fineFuelMoistureCode(85, 25, 30, 10, 0);
    const wet = fineFuelMoistureCode(85, 25, 30, 10, 12);
    expect(dry).toBeGreaterThan(85);
    expect(wet).toBeLessThan(85);
  });

  it('a long dry spell drives the drought code up day after day', () => {
    let dc = 15;
    for (let i = 0; i < 30; i++) dc = droughtCode(dc, 30, 0, 7);
    expect(dc).toBeGreaterThan(15 + 29 * 6); // ≥ ~6.6 per hot July day
  });

  it('heavy rain pulls the duff code back towards zero', () => {
    const before = duffMoistureCode(60, 20, 50, 0, 7);
    const after = duffMoistureCode(60, 20, 50, 40, 7);
    expect(after).toBeLessThan(before / 2);
  });

  it('light rain below the thresholds changes nothing but the drying', () => {
    // 0.5 mm for FFMC, 1.5 mm for DMC, 2.8 mm for DC: below those the rain
    // never reaches the fuel layer and the code only sees the day's drying.
    expect(duffMoistureCode(20, 20, 50, 1.4, 7)).toBeCloseTo(duffMoistureCode(20, 20, 50, 0, 7), 10);
    expect(droughtCode(100, 20, 2.7, 7)).toBeCloseTo(droughtCode(100, 20, 0, 7), 10);
  });

  it('never goes negative', () => {
    expect(droughtCode(0, -10, 100, 1)).toBeGreaterThanOrEqual(0);
    expect(duffMoistureCode(0, -10, 100, 100, 1)).toBeGreaterThanOrEqual(0);
    expect(buildupIndex(0, 0)).toBe(0);
  });
});

describe('the indices', () => {
  it('ISI grows with wind at a fixed FFMC', () => {
    expect(initialSpreadIndex(90, 40)).toBeGreaterThan(initialSpreadIndex(90, 10));
  });

  it('FWI meets itself at the bb = 1 seam and keeps rising beyond it', () => {
    // Below bb ≤ 1 the index IS bb; above, an exponential of its log. The
    // branches meet at exactly 1 — and the upper one is steep there (its
    // slope is unbounded at the seam), so only equality AT the seam and
    // monotonicity past it are fair to assert.
    const isiAtOne = 1 / (0.1 * (0.626 * 10 ** 0.809 + 2));
    expect(fireWeatherIndex(isiAtOne, 10)).toBeCloseTo(1, 6);
    const above = fireWeatherIndex(isiAtOne * 1.01, 10);
    expect(above).toBeGreaterThan(1);
    expect(fireWeatherIndex(isiAtOne * 1.1, 10)).toBeGreaterThan(above);
  });
});

describe('EFFIS danger classes', () => {
  it('use the published lower bounds', () => {
    expect(classify(0)).toBe('very_low');
    expect(classify(5.19)).toBe('very_low');
    expect(classify(5.2)).toBe('low');
    expect(classify(11.2)).toBe('moderate');
    expect(classify(21.3)).toBe('high');
    expect(classify(38)).toBe('very_high');
    expect(classify(50)).toBe('extreme');
    expect(classify(120)).toBe('extreme');
  });

  it('are listed in ascending order — classify() depends on it', () => {
    const bounds = DANGER_CLASS_LOWER_BOUNDS.map(([, b]) => b);
    expect([...bounds].sort((a, b) => a - b)).toEqual(bounds);
  });
});

describe('hourly → daily', () => {
  const hour = (at: string, precip = 0) => ({
    at,
    temperatureC: 20,
    relativeHumidityPct: 40,
    windSpeedKmh: 10,
    precipitationMm: precip,
  });

  it('takes the noon reading and sums the 24 hours of rain before it', () => {
    const hours = [];
    for (let h = 0; h < 48; h++) {
      const day = h < 24 ? '01' : '02';
      const hh = String(h % 24).padStart(2, '0');
      // 1 mm in every hour of day 1, none on day 2
      hours.push(hour(`2026-07-${day}T${hh}:00+02:00`, h < 24 ? 1 : 0));
    }
    const days = dailyInputsFromHourly(hours);
    expect(days.map((d) => d.date)).toEqual(['2026-07-01', '2026-07-02']);
    // Day 1's noon: 13 hours of history available (00:00–12:00), all rainy.
    expect(days[0]!.rain24hMm).toBe(13);
    // Day 2's noon: the 24 h to noon span 13:00 day 1 → 12:00 day 2 = 11 rainy hours.
    expect(days[1]!.rain24hMm).toBe(11);
    expect(days[1]!.month).toBe(7);
  });

  it('skips a day with no noon reading rather than inventing one', () => {
    const hours = [hour('2026-07-01T11:00+02:00'), hour('2026-07-01T13:00+02:00'), hour('2026-07-02T12:00+02:00')];
    expect(dailyInputsFromHourly(hours).map((d) => d.date)).toEqual(['2026-07-02']);
  });
});

describe('the series', () => {
  it('carries the codes forward day by day', () => {
    const days = [REFERENCE_DAY, { ...REFERENCE_DAY, date: '1985-04-14' }];
    const series = computeFireWeatherSeries(days);
    expect(series).toHaveLength(2);
    // Second dry day continues from the first's codes, so everything is higher.
    expect(series[1]!.dc).toBeGreaterThan(series[0]!.dc);
    expect(series[1]!.fwi).toBeGreaterThan(series[0]!.fwi);
  });
});
