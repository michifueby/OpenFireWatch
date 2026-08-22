/**
 * The record: every verdict the system has reached recently, and what the
 * crew found when they went to look.
 *
 * Collapsed by default — it is evidence for a decision, not part of the live
 * picture — and it is where the validation loop is closed: two taps record
 * whether an alarm was real, which is what makes the thresholds testable
 * against something other than opinion.
 */

import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { ApiError } from '@core/api/api-error';
import { TranslationService } from '@core/i18n/translation.service';

import { RealTimeAlertService } from './data-access/real-time-alert.service';

@Component({
  selector: 'ofw-alert-history',
  standalone: true,
  imports: [DatePipe, DecimalPipe],
  templateUrl: './alert-history.component.html',
  styleUrl: './alert-history.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertHistoryComponent {
  readonly i18n = inject(TranslationService);
  readonly alerts = inject(RealTimeAlertService);

  /** The record stays closed until asked for — the live picture comes first. */
  readonly open = signal(false);

  /** Why the last outcome recording failed — shown above the list. */
  readonly error = signal<string | null>(null);

  toggle(): void {
    this.open.update((v) => !v);
  }

  async recordOutcome(
    alertId: number,
    outcome: 'confirmed' | 'nothing_found',
  ): Promise<void> {
    this.error.set(null);
    try {
      await this.alerts.setOutcome(alertId, outcome);
    } catch (error) {
      this.error.set(
        error instanceof ApiError && error.locked
          ? this.i18n.t('ackNeedsKey')
          : (error as Error).message,
      );
    }
  }

  /** Coarse class for colour-coding a row by severity. */
  levelClass(level: string): 'critical' | 'elevated' | 'info' {
    if (level.startsWith('CRITICAL')) return 'critical';
    return level === 'ELEVATED' ? 'elevated' : 'info';
  }
}
