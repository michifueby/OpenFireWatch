/**
 * The outstanding critical warnings — the part of the dashboard a responder
 * is actually looking at.
 *
 * One card per unacknowledged alarm, carrying what somebody has to act on:
 * which zone, what was measured, the exact WGS84 coordinates, when the pass
 * was, and — where the system has one — the evidence behind the verdict.
 */

import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { ApiError } from '@core/api/api-error';
import { TranslationService } from '@core/i18n/translation.service';
import { IconComponent } from '@shared/ui/icon.component';

import { RealTimeAlertService } from './data-access/real-time-alert.service';

@Component({
  selector: 'ofw-alert-list',
  standalone: true,
  imports: [DatePipe, DecimalPipe, IconComponent],
  templateUrl: './alert-list.component.html',
  styleUrl: './alert-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertListComponent {
  readonly i18n = inject(TranslationService);
  readonly alerts = inject(RealTimeAlertService);

  /**
   * Why the last acknowledgement did not go through, and which alert it was
   * about. One at a time: a responder is acting on one alarm, and a column of
   * identical error lines would say nothing the first one did not.
   */
  readonly ackError = signal<{ id: number; message: string } | null>(null);

  /**
   * Take an alert. The list is not touched here — the server records it and
   * broadcasts, and this tab clears the alarm from that broadcast exactly
   * like every other connected client.
   */
  async acknowledge(alertId: number): Promise<void> {
    this.ackError.set(null);
    try {
      await this.alerts.acknowledge(alertId);
    } catch (error) {
      this.ackError.set({ id: alertId, message: this.explain(error) });
    }
  }

  /** Fill the evidence sentence with this alert's numbers. */
  smoulderingEvidence(sm: {
    passes: number;
    windowHours: number;
    peakFrpMw: number;
  }): string {
    return this.i18n.t('smoulderingEvidence', {
      passes: sm.passes,
      hours: sm.windowHours,
      frp: sm.peakFrpMw,
    });
  }

  /**
   * "locked" is the wire word, not something to show a responder — the panel
   * has to say where the key is entered.
   */
  private explain(error: unknown): string {
    if (error instanceof ApiError && error.locked) {
      return this.i18n.t('ackNeedsKey');
    }
    return (error as Error).message;
  }
}
