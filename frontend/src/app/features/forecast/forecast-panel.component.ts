/**
 * The rule read forwards: when does each zone next reach the point where a
 * detection would escalate?
 *
 * Sits under the conditions panel because it answers the next question a
 * reader has — not "how close is it now?" but "when does it get there?".
 */

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { TranslationService } from '@core/i18n/translation.service';

import { ForecastService, IgnitionWindow, ZoneForecast } from './data-access/forecast.service';
import { isImminent, outlookText, windowDetail } from './outlook';

@Component({
  selector: 'ofw-forecast-panel',
  standalone: true,
  templateUrl: './forecast-panel.component.html',
  styleUrl: './forecast-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForecastPanelComponent {
  readonly i18n = inject(TranslationService);
  readonly forecast = inject(ForecastService);

  private readonly t = this.i18n.t.bind(this.i18n);

  outlook(zone: ZoneForecast): string {
    return outlookText(zone, this.t, this.i18n.locale());
  }

  windowDetail(window: IgnitionWindow): string {
    return windowDetail(window, this.t);
  }

  isImminent(zone: ZoneForecast): boolean {
    return isImminent(zone);
  }
}
