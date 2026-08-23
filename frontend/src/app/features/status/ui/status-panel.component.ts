/**
 * The page that answers "is this thing actually watching?".
 *
 * It exists because on 14 August 2026 this deployment was healthy by every
 * measure it had — the process was up, cycles completed, the log said "no
 * hotspots in the monitored area" — while it polled one satellite out of
 * three. Four overpasses saw a fire over the Föhrenwald; the system fetched
 * one of them, 79 minutes late.
 *
 * So every row here says when a feed last delivered, never a bare "ok". The
 * distinction the page is built around: quiet is not the same as not looking.
 *
 * Collapsed by default and polled only while open — a diagnostic is
 * something you go and look at, not something that should compete with the
 * live picture.
 */

import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';

import { TranslationService } from '@core/i18n/translation.service';
import { TranslationDict } from '@core/i18n/translations';

import { FeedState, Freshness, StatusService } from '../data-access/status.service';

/** Refreshed on the ingestion rhythm while somebody is looking. */
const POLL_MS = 60_000;

@Component({
  selector: 'ofw-status-panel',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './status-panel.component.html',
  styleUrl: './status-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusPanelComponent {
  readonly i18n = inject(TranslationService);
  readonly status = inject(StatusService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = signal(false);

  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    this.destroyRef.onDestroy(() => clearInterval(this.timer));
  }

  async toggle(): Promise<void> {
    this.open.update((v) => !v);
    clearInterval(this.timer);

    if (!this.open()) return;
    await this.status.refresh();
    this.timer = setInterval(() => void this.status.refresh(), POLL_MS);
  }

  /** "vor 3 min" — an age a reader can judge without doing arithmetic. */
  age(feed: FeedState): string {
    if (feed.ageSeconds === null) return this.i18n.t('statusNever');
    const minutes = Math.round(feed.ageSeconds / 60);
    if (minutes < 1) return this.i18n.t('statusJustNow');
    if (minutes < 90) return this.i18n.t('statusMinutesAgo', { minutes });
    return this.i18n.t('statusHoursAgo', { hours: Math.round(minutes / 60) });
  }

  freshnessLabel(freshness: Freshness): string {
    const keys: Record<Freshness, keyof TranslationDict> = {
      ok: 'statusFresh',
      stale: 'statusStale',
      missing: 'statusMissing',
    };
    return this.i18n.t(keys[freshness]);
  }

  overallLabel(): string {
    const status = this.status.status();
    if (!status) return '';
    const keys = {
      ok: 'statusOverallOk',
      degraded: 'statusOverallDegraded',
      blind: 'statusOverallBlind',
    } as const;
    return this.i18n.t(keys[status.overall]);
  }

  /** Strip the family prefix: "VIIRS_NOAA20_NRT" reads as "NOAA20 · NRT". */
  sourceLabel(source: string): string {
    return source.replace(/^VIIRS_/, '').replace(/_/g, ' · ');
  }
}
