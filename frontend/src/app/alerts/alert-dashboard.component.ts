/**
 * AlertDashboardComponent — the "CRITICAL ALERTS" command-center overlay.
 *
 * A floating dark panel (top-right) that lists every unacknowledged
 * critical warning with the data a responder needs at a
 * glance: measured temperature, soil moisture, exact WGS84 coordinates, the
 * affected zone, and the satellite acquisition time. All readings render in
 * a monospaced font with tabular numerals so columns of digits stay aligned.
 *
 * Fully translated (EN/DE) via TranslationService — the active locale is a
 * signal, so all labels switch live without a reload. Purely reactive
 * otherwise: the template subscribes via the async pipe, so there are no
 * manual subscriptions to leak.
 */

import { CommonModule } from '@angular/common';
import { IconComponent } from '../shared/icon.component';
import { Component, OnDestroy, effect, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { TranslationService } from '../core/i18n/translation.service';
import {
  ConditionsService,
  ZoneReadiness,
} from '../core/services/conditions.service';
import {
  ForecastService,
  IgnitionWindow,
  ZoneForecast,
} from '../core/services/forecast.service';
import {
  HistoryService,
  YearSummary,
  ZoneHistory,
} from '../core/services/history.service';
import {
  LOCKED,
  RealTimeAlertService,
} from '../core/services/real-time-alert.service';

@Component({
  selector: 'ofw-alert-dashboard',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <section
      class="panel ofw-sheet"
      [class.sheet-open]="sheetOpen()"
      [attr.aria-label]="i18n.t('dashboardAria')"
    >
      <!-- Phone layout only (the desktop rules hide it): the grab bar that
           collapses the panel down to one line of situation summary, so the
           map underneath stays usable on a 375 px screen. -->
      <button
        type="button"
        [class]="'sheet-handle tone-' + peekTone()"
        (click)="sheetOpen.set(!sheetOpen())"
        [attr.aria-expanded]="sheetOpen()"
        aria-controls="ofw-sheet-body"
        [attr.aria-label]="
          sheetOpen() ? i18n.t('sheetCollapse') : i18n.t('sheetExpand')
        "
      >
        <span class="peek">{{ peekText() }}</span>
        <span class="chevron" aria-hidden="true">{{ sheetOpen() ? '▾' : '▴' }}</span>
      </button>

      <div class="sheet-body" id="ofw-sheet-body">
        <div class="sheet-scroll">
          <header class="panel-header">
            <h2>
              <ofw-icon name="dot" />
              {{ i18n.t('dashboardTitle') }}
            </h2>
            <span
              class="status"
              [class.online]="alerts.connected$ | async"
              [attr.title]="
                (alerts.connected$ | async)
                  ? i18n.t('gatewayConnected')
                  : i18n.t('gatewayReconnecting')
              "
            >
              {{ (alerts.connected$ | async) ? i18n.t('live') : i18n.t('offline') }}
            </span>
          </header>

          <!-- What the ground looks like right now. Placed above the alerts
               because it answers the question that comes first: how close is
               each zone to the point where a detection would escalate? -->
          <section class="conditions" *ngIf="cond.conditions() as c">
            <h3>{{ i18n.t('conditionsTitle') }}</h3>

            <p class="empty" *ngIf="!c.available">{{ i18n.t('conditionsUnavailable') }}</p>

            <ng-container *ngIf="c.available">
              <!-- Same labelled layout as the alert cards: a bare "35.4 %"
                   reads as noise to anyone who did not build the system. -->
              <dl class="cond-readings">
                <div class="cond">
                  <dt>{{ i18n.t('conditionsTemp') }}</dt>
                  <dd class="c-temp">{{ c.temperatureC | number: '1.0-1' }}&nbsp;°C</dd>
                </div>
                <div class="cond">
                  <dt>{{ i18n.t('conditionsSoil') }}</dt>
                  <dd class="c-soil">{{ c.soilMoisturePct | number: '1.0-1' }}&nbsp;%</dd>
                </div>
                <div class="cond">
                  <dt>{{ i18n.t('conditionsHumidity') }}</dt>
                  <dd class="c-hum">{{ c.relativeHumidityPct | number: '1.0-0' }}&nbsp;%</dd>
                </div>
              </dl>
              <p class="c-meta">
                {{ i18n.t('conditionsStation') }} {{ c.stationId }} ·
                {{ i18n.t('conditionsAsOf') }} {{ c.observedAt | date: 'HH:mm' }}
              </p>

              <ul class="readiness">
                <li
                  *ngFor="let z of c.zones"
                  [class.armed]="z.gate === 'weather' && z.armed"
                  [class.partial]="z.gate === 'weather' && !z.armed && partiallyMet(z)"
                  [class.always]="z.gate === 'detection'"
                >
                  <span class="r-name">{{ i18n.pick(z.name) }}</span>
                  <span class="r-state">{{ readiness(z) }}</span>
                </li>
              </ul>
            </ng-container>
          </section>

          <!-- The rule read forwards. Placed under the conditions because it
               answers the next question a reader has: not "how close is it
               now?" but "when does it get there?" -->
          <section class="outlook" *ngIf="forecast.forecast() as f">
            <h3>{{ i18n.t('forecastTitle') }}</h3>

            <p class="empty" *ngIf="!f.available">
              {{ i18n.t('forecastUnavailable') }}
            </p>

            <ul class="outlook-list" *ngIf="f.available">
              <li
                *ngFor="let z of f.zones"
                [class.imminent]="isImminent(z)"
                [class.upcoming]="!isImminent(z) && z.windows.length > 0"
              >
                <span class="o-name">{{ i18n.pick(z.name) }}</span>
                <span class="o-state">{{ outlook(z) }}</span>
                <span class="o-detail" *ngIf="z.windows[0] as w">
                  {{ windowDetail(w) }}
                </span>
              </li>
            </ul>
          </section>

          <p class="empty" *ngIf="(alerts.activeWarnings$ | async)?.length === 0">
            {{ i18n.t('noActiveAlerts') }}
          </p>

          <ul class="feed">
            <li class="alert" *ngFor="let warning of alerts.activeWarnings$ | async">
              <div class="alert-head">
                <span class="alert-id">
                  #{{ warning.id }} {{ i18n.levelLabel(warning.level) }}
                </span>
                <button
                  type="button"
                  class="ack"
                  (click)="acknowledge(warning.id)"
                  [attr.aria-label]="i18n.t('ackAria')"
                  [attr.title]="i18n.t('ackAria')"
                >
                  {{ i18n.t('ack') }}
                </button>
              </div>

              <div class="zone" *ngIf="warning.zone">
                ▸ {{ i18n.pick(warning.zone.name) }}
              </div>

              <!-- Why the button did nothing, next to the button that did
                   nothing — the operator key is unlocked in the zones panel,
                   which is not where anyone would think to look on their own. -->
              <p class="ack-error" *ngIf="ackError()?.id === warning.id">
                {{ ackError()?.message }}
              </p>

              <!-- Why the system called it a smouldering nest, in the operator's
                   own terms — the evidence, not just the verdict. -->
              <div class="evidence" *ngIf="warning.smouldering as sm">
                <ofw-icon name="flame" />
                {{ smoulderingEvidence(sm) }}
              </div>

              <dl class="readings">
                <div class="reading">
                  <dt>{{ i18n.t('labelTemp') }}</dt>
                  <dd class="hot">{{ warning.weather.temperatureC | number: '1.1-1' }}&nbsp;°C</dd>
                </div>
                <div class="reading">
                  <dt>{{ i18n.t('labelSoil') }}</dt>
                  <dd class="dry">{{ warning.weather.soilMoisturePct | number: '1.1-1' }}&nbsp;%</dd>
                </div>
                <div class="reading">
                  <dt>{{ i18n.t('labelCoords') }}</dt>
                  <dd>
                    {{ warning.latitude | number: '1.4-4' }},
                    {{ warning.longitude | number: '1.4-4' }}
                  </dd>
                </div>
                <div class="reading">
                  <dt>{{ i18n.t('labelAcquired') }}</dt>
                  <dd>{{ warning.acquiredAt | date: 'HH:mm:ss' : 'UTC' }}Z</dd>
                </div>
              </dl>
            </li>
          </ul>

          <!-- How often the window has been open in past seasons. Collapsed:
               it is context for a decision, not part of the live picture. -->
          <footer class="history-toggle">
            <button type="button" (click)="toggleSeason()">
              {{ showSeason() ? i18n.t('seasonHide') : i18n.t('seasonShow') }}
            </button>
          </footer>

          <section class="season" *ngIf="showSeason()">
            <h3>{{ i18n.t('seasonTitle') }}</h3>

            <p class="empty" *ngIf="!seasonZones().length">
              {{ i18n.t('seasonEmpty') }}
            </p>

            <div class="season-zone" *ngFor="let z of seasonZones()">
              <div class="s-zone-name">{{ i18n.pick(z.name) }}</div>
              <div class="s-average" *ngIf="z.averageDaysPerYear !== null">
                {{ averageLabel(z) }}
              </div>

              <ul class="season-bars">
                <li *ngFor="let y of z.years" [class.current]="isCurrentYear(y)">
                  <span class="s-year">{{ y.year }}</span>
                  <span class="s-bar" [style.width.%]="barWidth(y, z)"></span>
                  <span class="s-days">{{ daysLabel(y) }}</span>
                </li>
              </ul>

              <p class="s-source">{{ i18n.t('seasonSource') }}</p>
            </div>
          </section>

          <!-- The database has recorded every verdict since day one; this is the
               part of it a responder can actually look at. Collapsed by default
               so it never competes with what is happening right now. -->
          <footer class="history-toggle">
            <button type="button" (click)="showHistory.set(!showHistory())">
              {{ showHistory() ? i18n.t('historyHide') : i18n.t('historyShow') }}
            </button>
          </footer>

          <section class="history" *ngIf="showHistory()">
            <h3>{{ i18n.t('historyTitle') }}</h3>

            <p class="empty" *ngIf="(alerts.history$ | async)?.length === 0">
              {{ i18n.t('historyEmpty') }}
            </p>

            <ol class="history-list">
              <li
                *ngFor="let entry of alerts.history$ | async"
                [class]="'lvl-' + levelClass(entry.level)"
                [class.acked]="entry.acknowledgedAt"
              >
                <span class="h-time">{{ entry.evaluatedAt ?? entry.acquiredAt | date: 'dd.MM. HH:mm' }}</span>
                <span class="h-level">
                  <span
                    class="h-acked"
                    *ngIf="entry.acknowledgedAt as at"
                    [attr.title]="
                      i18n.t('ackedAt') + ' ' + (at | date: 'dd.MM. HH:mm')
                    "
                    >✓</span
                  >
                  {{ i18n.levelLabel(entry.level) }}
                </span>
                <span class="h-zone">
                  {{ entry.zone ? i18n.pick(entry.zone.name) : i18n.t('historyOutsideZones') }}
                </span>
                <span class="h-readings">
                  {{ entry.weather.temperatureC | number: '1.0-0' }}°C ·
                  {{ entry.weather.soilMoisturePct | number: '1.0-0' }}%
                </span>
              </li>
            </ol>
          </section>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      // Component-scoped SCSS (compiled via inlineStyleLanguage: "scss").
      $alert-red: #ff2d1a;
      $font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas,
        monospace;

      .panel {
        position: fixed;
        top: 1rem;
        right: 1rem;
        width: 22rem;
        max-height: calc(100vh - 2rem);
        max-height: calc(100dvh - 2rem);
        overflow-y: auto;
        border: 1px solid rgba($alert-red, 0.35);
        border-radius: 8px;
        background: rgba(7, 12, 20, 0.88);
        backdrop-filter: blur(6px); // frosted glass over the map
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
        color: #e6e8ee;
      }

      .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.7rem 0.9rem;
        border-bottom: 1px solid rgba($alert-red, 0.25);

        h2 {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          margin: 0;
          font-size: 0.8rem;
          font-weight: 700;
          letter-spacing: 0.14em;
          color: $alert-red;
        }
      }

      .status {
        font-family: $font-mono;
        font-size: 0.7rem;
        padding: 0.15rem 0.5rem;
        border-radius: 3px;
        color: #ff9d8f;
        border: 1px solid rgba($alert-red, 0.4);

        &.online {
          color: #7ee2a8;
          border-color: rgba(46, 160, 100, 0.5);
        }
      }

      .empty {
        margin: 0;
        padding: 1rem 0.9rem;
        font-family: $font-mono;
        font-size: 0.76rem;
        color: #8f99ab;
        text-align: center;
      }

      .feed {
        list-style: none;
        margin: 0;
        padding: 0.6rem;
        display: grid;
        gap: 0.6rem;
      }

      .alert {
        padding: 0.6rem 0.7rem;
        border-left: 3px solid $alert-red; // hazard stripe
        border-radius: 4px;
        background: rgba(59, 0, 0, 0.45);
      }

      .alert-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 0.5rem;
      }

      .alert-id {
        font-family: $font-mono;
        font-size: 0.76rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: #ffd166;
      }

      .ack {
        font-family: $font-mono;
        font-size: 0.68rem;
        padding: 0.2rem 0.55rem;
        border: 1px solid rgba(230, 232, 238, 0.35);
        border-radius: 3px;
        background: transparent;
        color: #e6e8ee;
        cursor: pointer;

        &:hover {
          border-color: $alert-red;
          color: $alert-red;
        }
      }

      .ack-error {
        margin: 0.4rem 0 0;
        font-size: 0.68rem;
        line-height: 1.4;
        color: #ffd7d0;
      }

      .evidence {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        margin-top: 0.3rem;
        font-family: $font-mono;
        font-size: 0.72rem;
        color: #ffd166;
      }

      .zone {
        margin-top: 0.3rem;
        font-size: 0.76rem;
        color: #ff9d8f;
      }

      .conditions {
        padding: 0.6rem 0.9rem;
        border-bottom: 1px solid rgba(230, 232, 238, 0.12);

        h3 {
          margin: 0 0 0.4rem;
          font-family: $font-mono;
          font-size: 0.66rem;
          letter-spacing: 0.12em;
          color: #8f99ab;
        }
      }

      .cond-readings {
        margin: 0;
        display: grid;
        grid-template-columns: repeat(3, auto);
        justify-content: start;
        gap: 0.45rem 1.1rem;
        font-family: $font-mono;
        font-variant-numeric: tabular-nums;

        dt {
          font-size: 0.66rem;
          letter-spacing: 0.08em;
          color: #8f99ab;
        }

        dd {
          margin: 0.1rem 0 0;
          font-size: 0.78rem;
        }

        .c-temp {
          color: #ff8b5e;
        }
        .c-soil {
          color: #ffd166;
        }
        .c-hum {
          color: #9aa4b2;
        }
      }

      .c-meta {
        margin: 0.35rem 0 0;
        font-family: $font-mono;
        font-size: 0.7rem;
        color: #8f99ab;
      }

      .readiness {
        list-style: none;
        margin: 0.5rem 0 0;
        padding: 0;
        display: grid;
        gap: 0.3rem;

        li {
          padding-left: 0.5rem;
          border-left: 2px solid #3a4560;
          font-size: 0.74rem;
          color: #9aa4b2;

          /*
           * A detection-gated zone is armed by definition — it will look like
           * this forever. Colouring it red would spend the alarm colour on a
           * property rather than a state, and a row that is permanently red
           * teaches people to stop noticing red.
           */
          &.always {
            border-left-color: #3a4560;

            .r-state {
              color: #8b95a7;
            }
          }

          &.partial {
            border-left-color: #ffa023;

            .r-state {
              color: #ffa023;
            }
          }

          &.armed {
            border-left-color: $alert-red;

            .r-state {
              color: $alert-red;
            }
          }
        }
      }

      .r-name {
        display: block;
        color: #c6ccd6;
      }

      .r-state {
        font-family: $font-mono;
        font-size: 0.7rem;
        color: #8f99ab;
      }

      .outlook {
        padding: 0.6rem 0.9rem;
        border-bottom: 1px solid rgba(230, 232, 238, 0.12);

        h3 {
          margin: 0 0 0.4rem;
          font-family: $font-mono;
          font-size: 0.66rem;
          letter-spacing: 0.12em;
          color: #8f99ab;
        }
      }

      .outlook-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.35rem;

        li {
          padding-left: 0.5rem;
          border-left: 2px solid #3a4560;
          font-size: 0.74rem;
          color: #9aa4b2;

          /* A window inside three days is something to act on; one further
             out is worth knowing but not worth alarming about. */
          &.upcoming {
            border-left-color: #ffa023;
          }

          &.imminent {
            border-left-color: $alert-red;

            .o-state {
              color: $alert-red;
            }
          }
        }
      }

      .o-name {
        display: block;
        color: #c6ccd6;
      }

      /*
       * Neutral by default. "Escalates on detection" and "no window ahead"
       * are not states to be alarmed about, and a coloured row that never
       * changes teaches the eye to stop reading the colour — the same trap
       * the conditions list fell into.
       */
      .o-state {
        font-family: $font-mono;
        font-size: 0.7rem;
        color: #8f99ab;
      }

      .outlook-list li.upcoming .o-state {
        color: #ffa023;
      }

      .o-detail {
        display: block;
        font-family: $font-mono;
        font-size: 0.68rem;
        color: #8f99ab;
      }

      .history-toggle {
        padding: 0 0.6rem 0.6rem;

        button {
          width: 100%;
          padding: 0.3rem;
          border: 1px dashed rgba(230, 232, 238, 0.25);
          border-radius: 4px;
          background: transparent;
          color: #8b95a7;
          font-family: $font-mono;
          font-size: 0.7rem;
          letter-spacing: 0.08em;
          cursor: pointer;

          &:hover {
            border-color: $alert-red;
            color: $alert-red;
          }
        }
      }

      .season {
        padding: 0 0.6rem 0.7rem;

        h3 {
          margin: 0 0 0.4rem;
          font-family: $font-mono;
          font-size: 0.66rem;
          letter-spacing: 0.12em;
          color: #8f99ab;
        }
      }

      .season-zone {
        margin-bottom: 0.7rem;
      }

      .s-zone-name {
        font-size: 0.76rem;
        color: #c6ccd6;
      }

      .s-average {
        font-family: $font-mono;
        font-size: 0.7rem;
        color: #8f99ab;
      }

      .season-bars {
        list-style: none;
        margin: 0.4rem 0 0;
        padding: 0;
        display: grid;
        gap: 0.2rem;
        font-family: $font-mono;
        font-size: 0.68rem;
        font-variant-numeric: tabular-nums;

        li {
          display: grid;
          /* The day column fits "999 T" without clipping; at 2.6rem a
             three-digit count lost its unit. */
          grid-template-columns: 2.6rem 1fr 3.4rem;
          align-items: center;
          gap: 0.4rem;
          color: #8f99ab;

          /* The running year is not comparable with the closed ones beside
             it — half a summer would otherwise read as a low year. */
          &.current {
            color: #c6ccd6;

            .s-bar {
              background: repeating-linear-gradient(
                90deg,
                #ffa023 0 4px,
                transparent 4px 7px
              );
            }
          }
        }
      }

      .s-bar {
        height: 0.5rem;
        min-width: 1px;
        border-radius: 2px;
        background: #ffa023;
      }

      .s-days {
        text-align: right;
      }

      .s-source {
        margin: 0.4rem 0 0;
        font-size: 0.66rem;
        line-height: 1.4;
        color: #8f99ab;
      }

      .history {
        padding: 0 0.6rem 0.7rem;

        h3 {
          margin: 0 0 0.4rem;
          font-family: $font-mono;
          font-size: 0.66rem;
          letter-spacing: 0.12em;
          color: #8f99ab;
        }
      }

      .history-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.2rem;
        font-family: $font-mono;
        font-size: 0.7rem;
        font-variant-numeric: tabular-nums;

        li {
          display: grid;
          grid-template-columns: 5.6rem 1fr;
          gap: 0.1rem 0.5rem;
          padding: 0.3rem 0.4rem;
          border-left: 2px solid #3a4560;
          border-radius: 3px;
          background: rgba(0, 0, 0, 0.25);
          color: #9aa4b2;

          &.lvl-critical {
            border-left-color: $alert-red;
          }
          &.lvl-elevated {
            border-left-color: #ffa023;
          }

          /* Handled: still on the record, no longer competing for attention. */
          &.acked {
            opacity: 0.62;
          }
        }
      }

      .h-time {
        color: #8f99ab;
      }
      .h-level {
        color: #e6e8ee;
      }

      .h-acked {
        color: #7ee2a8;
      }
      .h-zone,
      .h-readings {
        grid-column: 2;
      }
      .h-readings {
        color: #8f99ab;
      }

      // Monospace instrument readings, digits aligned via tabular numerals.
      .readings {
        margin: 0.55rem 0 0;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.45rem 0.9rem;
        font-family: $font-mono;
        font-variant-numeric: tabular-nums;

        dt {
          font-size: 0.66rem;
          letter-spacing: 0.08em;
          color: #8f99ab;
        }

        dd {
          margin: 0.1rem 0 0;
          font-size: 0.82rem;

          &.hot {
            color: #ff8b5e; // above the 30 °C ignition threshold
          }
          &.dry {
            color: #ffd166; // below the 20 % soil-moisture threshold
          }
        }
      }

      /* ---------------------------------------------------------------------
       * Phone layout: the floating panel becomes a bottom sheet.
       *
       * A 21rem panel is 90 % of a 375 px screen, so on a phone the desktop
       * layout hands you a map you cannot see and a panel you cannot close.
       * Collapsed, the sheet is one line of summary; expanded, it is the same
       * panel — the map keeps the top of the screen either way.
       * ------------------------------------------------------------------ */
      .sheet-handle {
        display: none; /* desktop: the panel is always fully shown */
      }

      @media (max-width: 640px) {
        .panel {
          position: fixed;
          // Only the sheet needs to outrank MapLibre's controls (see the
          // layer table in styles.scss). The side panel deliberately does
          // not: it never lies across the attribution, and raising it there
          // would hide the licence text behind a panel for no reason.
          z-index: 3;
          inset: auto 0 0;
          width: auto;
          max-height: none;
          overflow: visible;
          border-width: 1px 0 0;
          border-radius: 14px 14px 0 0;
          padding-bottom: var(--ofw-safe-bottom);

          /*
           * Collapsed by sliding the whole panel down until only the handle
           * shows, rather than by shrinking it. Two reasons: a transform
           * animates on the compositor where a height would relayout the
           * panel on every frame, and the panel keeps one stable height in
           * both states — which is what lets the map work out where to put an
           * incident without waiting for an animation to finish.
           */
          transform: translateY(
            calc(100% - var(--ofw-sheet-peek) - var(--ofw-safe-bottom))
          );
          transition: transform 0.28s ease;
        }

        .panel.sheet-open {
          transform: none;
        }

        .sheet-handle {
          position: relative;
          display: flex;
          align-items: center;
          gap: 0.6rem;
          width: 100%;
          /* Must equal --ofw-sheet-peek: that variable is what lifts the map
             attribution clear of this bar. */
          height: 3.25rem;
          padding: 0 1rem;
          border: none;
          background: transparent;
          color: inherit;
          text-align: left;
          cursor: pointer;

          /* The grab affordance every mobile sheet has. */
          &::before {
            content: '';
            position: absolute;
            top: 0.4rem;
            left: 50%;
            width: 2.25rem;
            height: 0.25rem;
            transform: translateX(-50%);
            border-radius: 999px;
            background: rgba(230, 232, 238, 0.28);
          }
        }

        .peek {
          flex: 1;
          min-width: 0; /* let the ellipsis win over the flex basis */
          overflow: hidden;
          font-family: $font-mono;
          font-size: 0.78rem;
          white-space: nowrap;
          text-overflow: ellipsis;
          color: #9aa4b2;
        }

        .tone-warn .peek {
          color: #ffa023;
        }

        .tone-critical .peek {
          color: $alert-red;
          font-weight: 700;
        }

        .chevron {
          flex: none;
          font-size: 0.9rem;
          color: #8f99ab;
        }

        .sheet-scroll {
          /* Bounded so that even a 568 px-tall phone keeps a strip of map
             above the sheet — MapComponent aims incidents into that strip
             (INCIDENT_SCREEN_FRACTION), and the two numbers only make sense
             together. */
          max-height: 60dvh;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          /* Scrolling to the end of the history must not start panning the
             map behind the sheet. */
          overscroll-behavior: contain;
        }

        /* Touch targets. Everything below was sized for a mouse pointer;
           a finger needs ~44 px, and the readings need a few more pixels
           before they stop being decoration on a phone screen. */
        .ack {
          min-height: 2.75rem;
          padding: 0.35rem 0.9rem;
          font-size: 0.72rem;
        }

        .history-toggle button {
          min-height: 2.75rem;
          font-size: 0.72rem;
        }

        .r-state,
        .history-list,
        .cond-readings .c-hum,
        .cond-readings .c-meta {
          font-size: 0.7rem;
        }

        .readiness li {
          padding: 0.15rem 0 0.15rem 0.5rem;
          font-size: 0.76rem;
        }

        .readings dt {
          font-size: 0.68rem;
        }

        /* The timestamp column was measured for 0.62rem type; at the larger
           mobile size "20.08. 15:30" no longer fits and wraps mid-date. */
        .history-list li {
          grid-template-columns: 5.6rem 1fr;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .panel {
          transition: none;
        }
      }
    `,
  ],
})
export class AlertDashboardComponent implements OnDestroy {
  /** History stays collapsed until asked for — the live picture comes first. */
  readonly showHistory = signal(false);

  /** Same for the seasonal record, which is context rather than news. */
  readonly showSeason = signal(false);

  /**
   * Why the last acknowledgement did not go through, and which alert it was
   * about. One at a time: a responder is acting on one alarm, and a column of
   * identical error lines would say nothing the first one did not.
   */
  readonly ackError = signal<{ id: number; message: string } | null>(null);

  /**
   * Take an alert. The list is not touched here — the server records it and
   * broadcasts, and this tab clears the alarm from that broadcast exactly like
   * every other connected client.
   */
  async acknowledge(alertId: number): Promise<void> {
    this.ackError.set(null);
    try {
      await this.alerts.acknowledge(alertId);
    } catch (error) {
      const message = (error as Error).message;
      this.ackError.set({
        id: alertId,
        message: message === LOCKED ? this.i18n.t('ackNeedsKey') : message,
      });
    }
  }

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
   */
  private peek(): { text: string; tone: 'critical' | 'warn' | 'quiet' } {
    if (!this.alerts.isConnected) {
      return { text: this.i18n.t('offline'), tone: 'warn' };
    }

    const active = this.alerts.activeWarnings.length;
    if (active > 0) {
      const noun = this.i18n.t(active === 1 ? 'sheetAlert' : 'sheetAlerts');
      return { text: `${active} ${noun}`, tone: 'critical' };
    }

    const zones = this.cond.conditions()?.zones ?? [];
    const armed = zones.find((z) => z.gate === 'weather' && z.armed);
    if (armed) {
      return {
        text: `${this.i18n.pick(armed.name)} — ${this.readiness(armed)}`,
        tone: 'critical',
      };
    }

    const near = zones.find((z) => this.partiallyMet(z));
    if (near) {
      return {
        text: `${this.i18n.pick(near.name)} — ${this.readiness(near)}`,
        tone: 'warn',
      };
    }

    return { text: this.i18n.t('sheetQuiet'), tone: 'quiet' };
  }

  // Split into two primitive-returning calls on purpose: binding an object
  // that is rebuilt on every change-detection pass makes Angular's dev-mode
  // verification pass see a "changed" value every time.
  peekText(): string {
    return this.peek().text;
  }

  peekTone(): 'critical' | 'warn' | 'quiet' {
    return this.peek().tone;
  }

  /**
   * One line stating whether this zone would escalate right now, and if not,
   * how far the conditions still are from its threshold.
   */
  readiness(z: ZoneReadiness): string {
    if (z.gate === 'detection') return this.i18n.t('conditionsOnDetection');
    if (z.armed) return this.i18n.t('conditionsArmed');

    // Which of the two conditions is already satisfied matters: "one hot
    // afternoon away" is a very different situation from "nowhere near", and
    // reporting a clamped 0 for an already-crossed threshold hid exactly that.
    const tempMet = (z.temperatureGapC ?? 1) <= 0;
    const soilMet = (z.soilMoistureGapPct ?? 1) < 0;

    if (soilMet && !tempMet) {
      return this.i18n
        .t('conditionsGapTempOnly')
        .replace('{temp}', formatGap(z.temperatureGapC));
    }
    if (tempMet && !soilMet) {
      return this.i18n
        .t('conditionsGapSoilOnly')
        .replace('{soil}', formatGap(z.soilMoistureGapPct));
    }
    return this.i18n
      .t('conditionsGap')
      .replace('{temp}', formatGap(z.temperatureGapC))
      .replace('{soil}', formatGap(z.soilMoistureGapPct));
  }

  /** One of the two weather conditions already satisfied — worth flagging. */
  partiallyMet(z: ZoneReadiness): boolean {
    if (z.gate !== 'weather') return false;
    return (z.temperatureGapC ?? 1) <= 0 || (z.soilMoistureGapPct ?? 1) < 0;
  }

  /** Opened on demand; the fetch happens once and is then cached. */
  async toggleSeason(): Promise<void> {
    this.showSeason.set(!this.showSeason());
    if (this.showSeason()) await this.history.load();
  }

  /** Only zones the question applies to — see ForecastService. */
  seasonZones(): ZoneHistory[] {
    return (this.history.history()?.zones ?? []).filter(
      (zone) => zone.weatherGated && zone.years.length > 0,
    );
  }

  averageLabel(zone: ZoneHistory): string {
    return this.i18n
      .t('seasonAverage')
      .replace('{days}', String(zone.averageDaysPerYear ?? 0));
  }

  daysLabel(year: YearSummary): string {
    return this.i18n.t('seasonDays').replace('{days}', String(year.days));
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

  /**
   * One line per zone: when its ignition window next opens, or why the
   * question does not apply.
   */
  outlook(zone: ZoneForecast): string {
    if (!zone.weatherGated) return this.i18n.t('forecastNotWeatherGated');
    const next = zone.windows[0];
    if (!next) return this.i18n.t('forecastNone');

    const start = new Date(next.from);
    const day = start.toLocaleDateString(
      this.i18n.locale() === 'de' ? 'de-AT' : 'en-GB',
      { weekday: 'long', day: '2-digit', month: '2-digit' },
    );
    const window = this.i18n
      .t('forecastWindow')
      .replace('{day}', day)
      .replace('{from}', next.from.slice(11, 16))
      .replace('{to}', next.to.slice(11, 16));

    const lead = this.i18n
      .t('forecastLeadTime')
      .replace('{hours}', String(zone.hoursUntilNextWindow ?? 0));
    return `${window} · ${lead}`;
  }

  /** The peak values inside the window — what makes it a window. */
  windowDetail(window: IgnitionWindow): string {
    return this.i18n
      .t('forecastPeak')
      .replace('{temp}', String(window.peakTemperatureC))
      .replace('{soil}', String(window.minSoilMoisturePct));
  }

  /** Within three days: close enough to plan around. */
  isImminent(zone: ZoneForecast): boolean {
    return (
      zone.windows.length > 0 &&
      zone.hoursUntilNextWindow !== null &&
      zone.hoursUntilNextWindow <= 72
    );
  }

  /** Coarse class for colour-coding a history row by severity. */
  levelClass(level: string): 'critical' | 'elevated' | 'info' {
    if (level.startsWith('CRITICAL')) return 'critical';
    return level === 'ELEVATED' ? 'elevated' : 'info';
  }

  /** Fill the evidence sentence with this alert's numbers. */
  smoulderingEvidence(sm: {
    passes: number;
    windowHours: number;
    peakFrpMw: number;
  }): string {
    return this.i18n
      .t('smoulderingEvidence')
      .replace('{passes}', String(sm.passes))
      .replace('{hours}', String(sm.windowHours))
      .replace('{frp}', String(sm.peakFrpMw));
  }

  constructor(
    readonly alerts: RealTimeAlertService,
    readonly i18n: TranslationService,
    readonly cond: ConditionsService,
    readonly forecast: ForecastService,
    readonly history: HistoryService,
  ) {
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

/** Set on <body> so global rules can react to the sheet's state. */
const SHEET_EXPANDED_CLASS = 'ofw-sheet-expanded';

/** A crossed threshold reads as 0 rather than a confusing negative distance. */
function formatGap(value: number | undefined): string {
  if (value === undefined) return '?';
  return String(Math.max(0, Math.round(value * 10) / 10));
}
