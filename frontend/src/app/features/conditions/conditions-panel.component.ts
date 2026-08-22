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

import { ConditionsService, ZoneReadiness } from './data-access/conditions.service';
import { isPartiallyMet, readinessText, windFrom } from './readiness';

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
}
