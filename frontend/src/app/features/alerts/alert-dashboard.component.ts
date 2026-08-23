/**
 * AlertDashboardComponent — the "CRITICAL ALERTS" command-center overlay.
 *
 * A floating dark panel (a bottom sheet on a phone) that composes the five
 * things a responder needs, in the order the questions arrive: how close are
 * we, when does it get there, what is happening now, how often has it
 * happened before, and what did we find last time.
 *
 * This component owns none of those answers. It owns the sheet: whether it is
 * open, what its one collapsed line says, and where the map attribution has
 * to move to stay out of its way. Everything else is a feature component that
 * fetches its own data — which is why this file is a hundred lines instead of
 * the thirteen hundred it used to be.
 */

import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { TranslationService } from '@core/i18n/translation.service';
import { ConditionsService } from '@features/conditions/data-access/conditions.service';
import { ConditionsPanelComponent } from '@features/conditions/conditions-panel.component';
import { isPartiallyMet, readinessText } from '@features/conditions/readiness';
import { ForecastPanelComponent } from '@features/forecast/forecast-panel.component';
import { SeasonPanelComponent } from '@features/history/season-panel.component';
import { StatusPanelComponent } from '@features/status/ui/status-panel.component';
import { IconComponent } from '@shared/ui/icon.component';

import { AlertHistoryComponent } from './alert-history.component';
import { AlertListComponent } from './alert-list.component';
import { RealTimeAlertService } from './data-access/real-time-alert.service';

/** Set on <body> so global rules can react to the sheet's state. */
const SHEET_EXPANDED_CLASS = 'ofw-sheet-expanded';

@Component({
  selector: 'ofw-alert-dashboard',
  standalone: true,
  imports: [
    IconComponent,
    ConditionsPanelComponent,
    ForecastPanelComponent,
    AlertListComponent,
    SeasonPanelComponent,
    AlertHistoryComponent,
    StatusPanelComponent,
  ],
  templateUrl: './alert-dashboard.component.html',
  styleUrl: './alert-dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertDashboardComponent implements OnDestroy {
  readonly i18n = inject(TranslationService);
  readonly alerts = inject(RealTimeAlertService);
  private readonly cond = inject(ConditionsService);

  /**
   * Whether the phone-sized sheet is expanded. Ignored by the desktop layout,
   * where the panel is always fully visible.
   *
   * Starts collapsed: someone opening the site on a phone came for the map,
   * and a panel that covers it before they have asked anything is in the way.
   */
  readonly sheetOpen = signal(false);

  /**
   * The single line the collapsed sheet shows, ranked by what would actually
   * make someone open it: a dead gateway first — every number underneath it
   * is stale and saying "all quiet" would be a lie — then live alarms, then
   * the zone closest to its threshold, then silence.
   *
   * A computed rather than two methods. It used to be called twice on every
   * change-detection pass (once for the text, once for the tone) because
   * returning the object itself handed Angular's dev-mode check a new
   * identity every time; a computed has one identity and one evaluation.
   */
  readonly peek = computed<{ text: string; tone: 'critical' | 'warn' | 'quiet' }>(
    () => {
      if (!this.alerts.connected()) {
        return { text: this.i18n.t('offline'), tone: 'warn' };
      }

      const active = this.alerts.activeWarnings().length;
      if (active > 0) {
        const noun = this.i18n.t(active === 1 ? 'sheetAlert' : 'sheetAlerts');
        return { text: `${active} ${noun}`, tone: 'critical' };
      }

      const zones = this.cond.conditions()?.zones ?? [];
      const t = this.i18n.t.bind(this.i18n);

      const armed = zones.find((z) => z.gate === 'weather' && z.armed);
      if (armed) {
        return {
          text: `${this.i18n.pick(armed.name)} — ${readinessText(armed, t)}`,
          tone: 'critical',
        };
      }

      const near = zones.find(isPartiallyMet);
      if (near) {
        return {
          text: `${this.i18n.pick(near.name)} — ${readinessText(near, t)}`,
          tone: 'warn',
        };
      }

      return { text: this.i18n.t('sheetQuiet'), tone: 'quiet' };
    },
  );

  constructor() {
    // A critical escalation opens the sheet by itself. On a desktop the panel
    // is always on screen, so this changes nothing there; on a phone it is
    // the difference between an alarm that shows the coordinates and one that
    // shows a line of text somebody still has to tap.
    this.alerts.criticalAlerts$
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.sheetOpen.set(true));

    // The map attribution is MapLibre's own DOM, outside this component's
    // view. The global stylesheet parks it above the collapsed sheet so the
    // licence text stays readable; once the sheet expands it has to drop back
    // down, or it floats on top of the panel it was meant to clear.
    effect(() => {
      document.body.classList.toggle(SHEET_EXPANDED_CLASS, this.sheetOpen());
    });
  }

  ngOnDestroy(): void {
    document.body.classList.remove(SHEET_EXPANDED_CLASS);
  }
}
