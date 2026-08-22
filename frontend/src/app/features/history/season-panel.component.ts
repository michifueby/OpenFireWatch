/**
 * How often the ignition window has stood open in past seasons.
 *
 * Context rather than news, so it stays collapsed and loads only when
 * somebody opens it — a decade of summers does not change while they are
 * looking at it.
 */

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { TranslationService } from '@core/i18n/translation.service';

import { HistoryService, YearSummary, ZoneHistory } from './data-access/history.service';

@Component({
  selector: 'ofw-season-panel',
  standalone: true,
  templateUrl: './season-panel.component.html',
  styleUrl: './season-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeasonPanelComponent {
  readonly i18n = inject(TranslationService);
  readonly history = inject(HistoryService);

  readonly open = signal(false);

  /** Opened on demand; the fetch happens once and is then cached. */
  async toggle(): Promise<void> {
    this.open.update((v) => !v);
    if (this.open()) await this.history.load();
  }

  /** Only zones the question applies to — see ForecastService. */
  zones(): ZoneHistory[] {
    return (this.history.history()?.zones ?? []).filter(
      (zone) => zone.weatherGated && zone.years.length > 0,
    );
  }

  averageLabel(zone: ZoneHistory): string {
    return this.i18n.t('seasonAverage', { days: zone.averageDaysPerYear ?? 0 });
  }

  daysLabel(year: YearSummary): string {
    return this.i18n.t('seasonDays', { days: year.days });
  }

  isCurrentYear(year: YearSummary): boolean {
    return year.year === new Date().getFullYear();
  }

  /**
   * Bar length relative to the worst year on record, so the shape of a decade
   * is readable at a glance without an axis.
   */
  barWidth(year: YearSummary, zone: ZoneHistory): number {
    const worst = Math.max(...zone.years.map((y) => y.days), 1);
    return Math.round((year.days / worst) * 100);
  }
}
