/**
 * The status page exists to be read at 03:00 by somebody deciding whether to
 * trust the map. Its job is wording, so that is what these check.
 */

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { TranslationService } from '@core/i18n/translation.service';

import { StatusPanelComponent } from './status-panel.component';

describe('StatusPanelComponent', () => {
  let panel: StatusPanelComponent;

  beforeEach(() => {
    localStorage.setItem('ofw-locale', 'en');
    // The panel injects StatusService, which reaches for HttpClient. Nothing
    // here makes a request — the wording is what is under test.
    TestBed.configureTestingModule({
      imports: [StatusPanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    panel = TestBed.createComponent(StatusPanelComponent).componentInstance;
    TestBed.inject(TranslationService).setLocale('en');
  });

  afterEach(() => localStorage.removeItem('ofw-locale'));

  const feed = (ageSeconds: number | null) => ({
    freshness: 'ok' as const,
    at: ageSeconds === null ? null : new Date().toISOString(),
    ageSeconds,
  });

  describe('age', () => {
    it('says "never" when nothing has ever arrived', () => {
      // Not "0 min ago", which would read as "just delivered".
      expect(panel.age(feed(null))).toBe('never');
    });

    it('says "just now" under a minute', () => {
      expect(panel.age(feed(0))).toBe('just now');
      expect(panel.age(feed(29))).toBe('just now');
    });

    it('counts in minutes up to an hour and a half', () => {
      expect(panel.age(feed(180))).toBe('3 min ago');
      expect(panel.age(feed(89 * 60))).toBe('89 min ago');
    });

    it('switches to hours beyond that, so nobody reads four digits', () => {
      expect(panel.age(feed(90 * 60))).toBe('2 h ago');
      expect(panel.age(feed(5 * 3600))).toBe('5 h ago');
    });
  });

  describe('freshnessLabel', () => {
    it('keeps "stale" and "nothing arriving" apart', () => {
      // The whole page turns on this distinction: one means the reading is
      // old, the other that the system is not looking.
      expect(panel.freshnessLabel('stale')).not.toBe(panel.freshnessLabel('missing'));
      expect(panel.freshnessLabel('ok')).toBe('fresh');
    });
  });

  describe('sourceLabel', () => {
    it('drops the family prefix a reader already knows', () => {
      expect(panel.sourceLabel('VIIRS_NOAA20_NRT')).toBe('NOAA20 · NRT');
      expect(panel.sourceLabel('VIIRS_SNPP_SP')).toBe('SNPP · SP');
    });

    it('leaves an unfamiliar product intact rather than mangling it', () => {
      expect(panel.sourceLabel('MODIS_NRT')).toBe('MODIS · NRT');
    });
  });

  it('starts collapsed — a diagnostic is something you go and look at', () => {
    expect(panel.open()).toBeFalse();
  });
});
