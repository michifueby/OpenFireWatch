/**
 * The satellite archive, replayed: a date range in, a run with progress out.
 *
 * Sits in the operator console under the incident register, because that is
 * what it serves — each fire in the register is held against the alert
 * record, and the record only reaches as far back as has been replayed.
 *
 * Polls while a run is queued or running, so the operator watches windows
 * tick past instead of reloading; stops polling the moment nothing is moving.
 */

import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiError } from '@core/api/api-error';
import { TranslationService } from '@core/i18n/translation.service';

import { BackfillApiService, BackfillRun } from '../data-access/backfill-api.service';

/** How often to re-read while a run is in progress. */
const POLL_MS = 5_000;

@Component({
  selector: 'ofw-backfill-panel',
  standalone: true,
  imports: [DatePipe, FormsModule],
  templateUrl: './backfill-panel.component.html',
  styleUrl: './backfill-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BackfillPanelComponent implements OnInit {
  readonly i18n = inject(TranslationService);
  private readonly api = inject(BackfillApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly busy = input(false);

  readonly runs = signal<BackfillRun[]>([]);
  readonly starting = signal(false);
  readonly error = signal<string | null>(null);

  /** Defaults to last calendar year — the most common thing to ask for. */
  readonly from = signal(`${new Date().getFullYear() - 1}-01-01`);
  readonly to = signal(`${new Date().getFullYear() - 1}-12-31`);

  readonly active = computed(() =>
    this.runs().find((r) => r.status === 'queued' || r.status === 'running') ?? null,
  );

  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    void this.refresh();
    this.timer = setInterval(() => {
      if (this.active()) void this.refresh();
    }, POLL_MS);
    this.destroyRef.onDestroy(() => clearInterval(this.timer));
  }

  async refresh(): Promise<void> {
    try {
      this.runs.set(await this.api.list());
    } catch {
      // The list is context; a failed read keeps what was there.
    }
  }

  async start(): Promise<void> {
    this.error.set(null);
    this.starting.set(true);
    try {
      await this.api.start(this.from(), this.to());
      await this.refresh();
    } catch (error) {
      this.error.set(
        error instanceof ApiError && error.locked
          ? this.i18n.t('zonesUnlockHint')
          : (error as Error).message,
      );
    } finally {
      this.starting.set(false);
    }
  }

  /**
   * The verdicts, worst first and named for a reader.
   *
   * This is what a replay is FOR: "32 detections" says nothing on its own,
   * "3 would have been critical" is the answer the register was built to
   * give.
   */
  verdictLines(run: BackfillRun): { label: string; count: number; critical: boolean }[] {
    return Object.entries(run.verdicts)
      .map(([level, count]) => ({
        label: this.i18n.levelLabel(level),
        count,
        critical: level.startsWith('CRITICAL'),
      }))
      .sort((a, b) => Number(b.critical) - Number(a.critical) || b.count - a.count);
  }

  progressPct(run: BackfillRun): number {
    if (!run.requestsTotal) return run.status === 'done' ? 100 : 0;
    return Math.round((run.requestsDone / run.requestsTotal) * 100);
  }

  statusLabel(run: BackfillRun): string {
    const keys = {
      queued: 'backfillQueued',
      running: 'backfillRunning',
      done: 'backfillDone',
      failed: 'backfillFailed',
    } as const;
    return this.i18n.t(keys[run.status]);
  }
}
