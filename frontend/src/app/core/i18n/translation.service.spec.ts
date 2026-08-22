import { TestBed } from '@angular/core/testing';

import { TranslationService } from './translation.service';

describe('TranslationService', () => {
  let i18n: TranslationService;

  beforeEach(() => {
    // The service persists an explicit choice, so without this a locale set
    // by one test decides what the next one is asserting against.
    localStorage.removeItem('ofw-locale');
    TestBed.configureTestingModule({});
    i18n = TestBed.inject(TranslationService);
  });

  afterEach(() => localStorage.removeItem('ofw-locale'));

  it('translates in the active locale and follows a change live', () => {
    i18n.setLocale('de');
    const german = i18n.t('conditionsTitle');
    i18n.setLocale('en');
    expect(i18n.t('conditionsTitle')).not.toBe(german);
  });

  it('fills placeholders by name', () => {
    i18n.setLocale('de');
    expect(i18n.t('seasonDays', { days: 18 })).toContain('18');
    expect(i18n.t('seasonDays', { days: 18 })).not.toContain('{days}');
  });

  it('leaves an unknown placeholder standing rather than blanking it', () => {
    // A visible `{days}` is a bug report from the panel itself; an empty gap
    // reads as a missing measurement.
    expect(i18n.t('seasonDays', { wrong: 1 })).toContain('{days}');
  });

  it('picks the active language out of a backend-supplied name', () => {
    i18n.setLocale('de');
    expect(i18n.pick({ de: 'Westteil', en: 'western part' })).toBe('Westteil');
    i18n.setLocale('en');
    expect(i18n.pick({ de: 'Westteil', en: 'western part' })).toBe('western part');
  });

  it('names every alert level the backend can send', () => {
    // Asserted in German: the English label for ELEVATED is the wire value
    // itself, which would make "was it translated?" unanswerable.
    i18n.setLocale('de');
    for (const level of [
      'ELEVATED',
      'CRITICAL_PHOSPHORUS_FIRE',
      'CRITICAL_WILDFIRE',
      'CRITICAL_ORDNANCE_HEAT',
      'CRITICAL_THERMAL_ANOMALY',
      'CRITICAL_SMOULDERING',
      'CRITICAL_SENSOR_HEAT',
    ]) {
      expect(i18n.levelLabel(level)).not.toBe(level);
    }
  });

  it('falls back to the raw level for one it has never heard of', () => {
    expect(i18n.levelLabel('CRITICAL_METEORITE')).toBe('CRITICAL_METEORITE');
  });
});
