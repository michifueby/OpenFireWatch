/**
 * The register of what actually happened, with each fire held against the
 * ignition-window history and the alert record.
 *
 * This is the part of the console that makes the thresholds testable: a fire
 * that fell outside every predicted window, or that raised no alert, is
 * evidence about the rule — and the two verdicts are shown side by side so
 * nobody has to go looking for the uncomfortable one.
 */

import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { TranslationService } from '@core/i18n/translation.service';
import { TranslationDict } from '@core/i18n/translations';

import {
  IncidentEntry,
  IncidentKind,
  IncidentSummary,
} from '../data-access/incident-api.service';

const KIND_LABELS: Readonly<Record<IncidentKind, keyof TranslationDict>> = {
  fire: 'kindFire',
  drill: 'kindDrill',
  observation: 'kindObservation',
};

@Component({
  selector: 'ofw-incident-list',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './incident-list.component.html',
  styleUrl: './incident-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IncidentListComponent {
  readonly i18n = inject(TranslationService);

  readonly incidents = input.required<readonly IncidentEntry[]>();
  readonly summary = input<IncidentSummary | null>(null);
  readonly busy = input(false);

  readonly add = output<void>();
  readonly remove = output<IncidentEntry>();

  readonly confirming = signal<number | null>(null);

  kindLabel(kind: IncidentKind): string {
    return this.i18n.t(KIND_LABELS[kind]);
  }

  /** The two validation verdicts, phrased for a reader. */
  windowLabel(incident: IncidentEntry): string {
    if (incident.inIgnitionWindow === null) {
      return this.i18n.t('incidentWindowUnknown');
    }
    return this.i18n.t(
      incident.inIgnitionWindow ? 'incidentInWindow' : 'incidentNotInWindow',
    );
  }

  summaryLine(summary: IncidentSummary): string {
    return this.i18n.t('incidentSummary', {
      fires: summary.fires,
      inWindow: summary.firesInWindow,
      applicable: summary.firesWindowApplicable,
      seen: summary.firesSeen,
      alerted: summary.firesAlerted,
    });
  }

  outcomesLine(summary: IncidentSummary): string {
    return this.i18n.t('incidentOutcomes', {
      confirmed: summary.alertsConfirmed,
      nothing: summary.alertsNothingFound,
    });
  }

  confirmRemove(incident: IncidentEntry): void {
    this.confirming.set(null);
    this.remove.emit(incident);
  }
}
