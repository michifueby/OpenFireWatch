/**
 * Which satellites the live cycle watches is not a detail: it decides how
 * many separate looks at the ground the system gets, and how soon.
 */

import { resolvePollSources } from './firms-sources';

const DEFAULTS = 'VIIRS_SNPP_NRT,VIIRS_NOAA20_NRT,VIIRS_NOAA21_NRT';

describe('resolvePollSources', () => {
  it('polls all three VIIRS instruments by default', () => {
    expect(resolvePollSources(DEFAULTS)).toEqual([
      'VIIRS_SNPP_NRT',
      'VIIRS_NOAA20_NRT',
      'VIIRS_NOAA21_NRT',
    ]);
  });

  it('gains the other two for a deployment still carrying the old default', () => {
    // The singular FIRMS_SOURCE shipped as VIIRS_SNPP_NRT, so nearly every
    // existing .env holds it. Honouring it as an override would freeze those
    // deployments on one satellite for good.
    expect(resolvePollSources(DEFAULTS, 'VIIRS_SNPP_NRT')).toEqual([
      'VIIRS_SNPP_NRT',
      'VIIRS_NOAA20_NRT',
      'VIIRS_NOAA21_NRT',
    ]);
  });

  it('keeps a source an operator deliberately added', () => {
    expect(resolvePollSources(DEFAULTS, 'MODIS_NRT')).toContain('MODIS_NRT');
    expect(resolvePollSources(DEFAULTS, 'MODIS_NRT')).toHaveLength(4);
  });

  it('trims whitespace and drops empty entries', () => {
    expect(resolvePollSources(' A , ,B ,')).toEqual(['A', 'B']);
  });

  it('never returns the same product twice', () => {
    expect(resolvePollSources('A,A,B', 'B')).toEqual(['A', 'B']);
  });
});
