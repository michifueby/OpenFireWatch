import { addDays, coverageGaps, daysBetween, planBackfill } from './satellite-backfill.plan';

/** The listing FIRMS returned on 22 Aug 2026, trimmed to what matters. */
const AVAILABILITY = [
  { source: 'VIIRS_SNPP_SP', minDate: '2012-01-20', maxDate: '2026-04-27' },
  { source: 'VIIRS_SNPP_NRT', minDate: '2026-04-28', maxDate: '2026-08-22' },
  { source: 'VIIRS_NOAA20_SP', minDate: '2018-04-01', maxDate: '2026-05-31' },
  { source: 'VIIRS_NOAA20_NRT', minDate: '2026-06-01', maxDate: '2026-08-22' },
  { source: 'MODIS_SP', minDate: '2000-11-01', maxDate: '2026-04-30' },
];

describe('date arithmetic', () => {
  it('adds days across a month end and a leap day', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts days inclusively-exclusive like a calendar', () => {
    expect(daysBetween('2026-07-01', '2026-07-01')).toBe(0);
    expect(daysBetween('2026-07-01', '2026-07-06')).toBe(5);
    expect(daysBetween('2026-07-06', '2026-07-01')).toBe(-5);
  });
});

describe('planBackfill', () => {
  it('cuts a range into windows of at most five days', () => {
    const plan = planBackfill('2022-07-01', '2022-07-12', ['VIIRS_SNPP'], AVAILABILITY);
    expect(plan).toEqual([
      { source: 'VIIRS_SNPP_SP', startDate: '2022-07-01', dayRange: 5 },
      { source: 'VIIRS_SNPP_SP', startDate: '2022-07-06', dayRange: 5 },
      { source: 'VIIRS_SNPP_SP', startDate: '2022-07-11', dayRange: 2 },
    ]);
  });

  it('switches stream where the archive ends and near-real-time begins', () => {
    // The boundary is 27/28 April 2026. A window across it must be split,
    // because the SP archive answers an NRT date with an empty CSV.
    const plan = planBackfill('2026-04-25', '2026-05-02', ['VIIRS_SNPP'], AVAILABILITY);
    expect(plan).toEqual([
      { source: 'VIIRS_SNPP_SP', startDate: '2026-04-25', dayRange: 3 },
      { source: 'VIIRS_SNPP_NRT', startDate: '2026-04-28', dayRange: 5 },
    ]);
  });

  it('asks nothing of a product for dates it does not hold', () => {
    // NOAA-20 only exists from April 2018; a 2015 range must not request it.
    const plan = planBackfill('2015-06-01', '2015-06-03', ['VIIRS_SNPP', 'VIIRS_NOAA20'], AVAILABILITY);
    expect(plan.map((r) => r.source)).toEqual(['VIIRS_SNPP_SP']);
  });

  it('interleaves families chronologically so evaluation sees time in order', () => {
    const plan = planBackfill('2022-07-01', '2022-07-10', ['VIIRS_SNPP', 'VIIRS_NOAA20'], AVAILABILITY);
    expect(plan.map((r) => r.startDate)).toEqual(['2022-07-01', '2022-07-01', '2022-07-06', '2022-07-06']);
  });

  it('refuses an inverted range', () => {
    expect(() => planBackfill('2022-07-10', '2022-07-01', ['VIIRS_SNPP'], AVAILABILITY)).toThrow(/inverted/);
  });

  it('ignores a family FIRMS has never heard of', () => {
    expect(planBackfill('2022-07-01', '2022-07-02', ['SENTINEL_X'], AVAILABILITY)).toEqual([]);
  });
});

describe('coverageGaps', () => {
  it('names the days no product covered, as ranges', () => {
    // SNPP begins on 20 Jan 2012; a request from New Year leaves a gap.
    const plan = planBackfill('2012-01-01', '2012-01-25', ['VIIRS_SNPP'], AVAILABILITY);
    expect(coverageGaps('2012-01-01', '2012-01-25', plan)).toEqual([
      { from: '2012-01-01', to: '2012-01-19' },
    ]);
  });

  it('is empty when the plan covers everything', () => {
    const plan = planBackfill('2022-07-01', '2022-07-31', ['VIIRS_SNPP'], AVAILABILITY);
    expect(coverageGaps('2022-07-01', '2022-07-31', plan)).toEqual([]);
  });
});
