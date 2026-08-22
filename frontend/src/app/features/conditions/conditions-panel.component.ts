/**
 * What the ground looks like right now, and how close each zone is to the
 * point where a detection would escalate.
 *
 * Placed above the alert list in the dashboard because it answers the
 * question that comes first — not "what happened?" but "how close are we?".
 */

import { DecimalPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { TranslationService } from '@core/i18n/translation.service';
import { TranslationDict } from '@core/i18n/translations';

import {
  ConditionsService,
  DangerClass,
  ZoneReadiness,
} from './data-access/conditions.service';
import { isPartiallyMet, readinessText, windFrom } from './readiness';

/** Danger class → the translation key that names it for a reader. */
const DANGER_LABELS: Readonly<Record<DangerClass, keyof TranslationDict>> = {
  very_low: 'dangerVeryLow',
  low: 'dangerLow',
  moderate: 'dangerModerate',
  high: 'dangerHigh',
  very_high: 'dangerVeryHigh',
  extreme: 'dangerExtreme',
};

@Component({
  selector: 'ofw-conditions-panel',
  standalone: true,
  imports: [DecimalPipe, DatePipe],
  templateUrl: './conditions-panel.component.html',
  styleUrl: './conditions-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConditionsPanelComponent {
  readonly i18n = inject(TranslationService);
  readonly cond = inject(ConditionsService);

  private readonly t = this.i18n.t.bind(this.i18n);

  readiness(zone: ZoneReadiness): string {
    return readinessText(zone, this.t);
  }

  partiallyMet(zone: ZoneReadiness): boolean {
    return isPartiallyMet(zone);
  }

  windFrom(degrees: number): string {
    return windFrom(degrees, this.t, this.i18n.locale() === 'de');
  }

  dangerLabel(dangerClass: DangerClass): string {
    return this.i18n.t(DANGER_LABELS[dangerClass]);
  }

  /**
   * Tone for the colour: the three upper classes are the ones a reader has to
   * notice. Below "high" the line is information, not a warning.
   */
  dangerTone(dangerClass: DangerClass): 'calm' | 'warn' | 'critical' {
    if (dangerClass === 'very_high' || dangerClass === 'extreme') return 'critical';
    if (dangerClass === 'high') return 'warn';
    return 'calm';
  }
}
