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
import { Component, signal } from '@angular/core';

import { TranslationService } from '../core/i18n/translation.service';
import {
  ConditionsService,
  ZoneReadiness,
} from '../core/services/conditions.service';
import { RealTimeAlertService } from '../core/services/real-time-alert.service';

@Component({
  selector: 'ofw-alert-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="panel" [attr.aria-label]="i18n.t('dashboardAria')">
      <header class="panel-header">
        <h2>⬤ {{ i18n.t('dashboardTitle') }}</h2>
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
          <div class="cond-readings">
            <span class="c-temp">{{ c.temperatureC | number: '1.0-1' }}&nbsp;°C</span>
            <span class="c-soil">{{ c.soilMoisturePct | number: '1.0-1' }}&nbsp;%</span>
            <span class="c-hum">
              {{ i18n.t('conditionsHumidity') }} {{ c.relativeHumidityPct | number: '1.0-0' }}&nbsp;%
            </span>
            <span class="c-meta">
              {{ i18n.t('conditionsStation') }} {{ c.stationId }} ·
              {{ c.observedAt | date: 'HH:mm' }}
            </span>
          </div>

          <ul class="readiness">
            <li
              *ngFor="let z of c.zones"
              [class.armed]="z.armed"
              [class.partial]="!z.armed && partiallyMet(z)"
            >
              <span class="r-name">{{ i18n.pick(z.name) }}</span>
              <span class="r-state">{{ readiness(z) }}</span>
            </li>
          </ul>
        </ng-container>
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
              (click)="alerts.dismissWarning(warning.id)"
              [attr.aria-label]="i18n.t('ackAria')"
              [attr.title]="i18n.t('ackAria')"
            >
              {{ i18n.t('ack') }}
            </button>
          </div>

          <div class="zone" *ngIf="warning.zone">
            ▸ {{ i18n.pick(warning.zone.name) }}
          </div>

          <!-- Why the system called it a smouldering nest, in the operator's
               own terms — the evidence, not just the verdict. -->
          <div class="evidence" *ngIf="warning.smouldering as sm">
            ◈ {{ smoulderingEvidence(sm) }}
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
          <li *ngFor="let entry of alerts.history$ | async" [class]="'lvl-' + levelClass(entry.level)">
            <span class="h-time">{{ entry.evaluatedAt ?? entry.acquiredAt | date: 'dd.MM. HH:mm' }}</span>
            <span class="h-level">{{ i18n.levelLabel(entry.level) }}</span>
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
    </section>
  `,
  styles: [
    `
      // Component-scoped SCSS (compiled via inlineStyleLanguage: "scss").
      $alert-red: #ff2d1a;
      $font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas,
        monospace;

      .panel {
        position: absolute;
        top: 1rem;
        right: 1rem;
        width: 21rem;
        max-height: calc(100vh - 2rem);
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
          margin: 0;
          font-size: 0.8rem;
          font-weight: 700;
          letter-spacing: 0.14em;
          color: $alert-red;
        }
      }

      .status {
        font-family: $font-mono;
        font-size: 0.65rem;
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
        font-size: 0.7rem;
        color: #6b7688;
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
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: #ffd166;
      }

      .ack {
        font-family: $font-mono;
        font-size: 0.6rem;
        padding: 0.15rem 0.45rem;
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

      .evidence {
        margin-top: 0.3rem;
        font-family: $font-mono;
        font-size: 0.66rem;
        color: #ffd166;
      }

      .zone {
        margin-top: 0.3rem;
        font-size: 0.72rem;
        color: #ff9d8f;
      }

      .conditions {
        padding: 0.6rem 0.9rem;
        border-bottom: 1px solid rgba(230, 232, 238, 0.12);

        h3 {
          margin: 0 0 0.4rem;
          font-family: $font-mono;
          font-size: 0.6rem;
          letter-spacing: 0.12em;
          color: #6b7688;
        }
      }

      .cond-readings {
        display: flex;
        flex-wrap: wrap;
        gap: 0.15rem 0.7rem;
        font-family: $font-mono;
        font-variant-numeric: tabular-nums;
        font-size: 0.78rem;

        .c-temp {
          color: #ff8b5e;
        }
        .c-soil {
          color: #ffd166;
        }
        .c-hum,
        .c-meta {
          font-size: 0.62rem;
          color: #6b7688;
          align-self: center;
        }
        .c-meta {
          flex-basis: 100%;
        }
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
          font-size: 0.68rem;
          color: #9aa4b2;

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
        font-size: 0.62rem;
        color: #6b7688;
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
          font-size: 0.62rem;
          letter-spacing: 0.08em;
          cursor: pointer;

          &:hover {
            border-color: $alert-red;
            color: $alert-red;
          }
        }
      }

      .history {
        padding: 0 0.6rem 0.7rem;

        h3 {
          margin: 0 0 0.4rem;
          font-family: $font-mono;
          font-size: 0.6rem;
          letter-spacing: 0.12em;
          color: #6b7688;
        }
      }

      .history-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 0.2rem;
        font-family: $font-mono;
        font-size: 0.62rem;
        font-variant-numeric: tabular-nums;

        li {
          display: grid;
          grid-template-columns: 4.6rem 1fr;
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
        }
      }

      .h-time {
        color: #6b7688;
      }
      .h-level {
        color: #e6e8ee;
      }
      .h-zone,
      .h-readings {
        grid-column: 2;
      }
      .h-readings {
        color: #6b7688;
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
          font-size: 0.58rem;
          letter-spacing: 0.1em;
          color: #6b7688;
        }

        dd {
          margin: 0.1rem 0 0;
          font-size: 0.78rem;

          &.hot {
            color: #ff8b5e; // above the 30 °C ignition threshold
          }
          &.dry {
            color: #ffd166; // below the 20 % soil-moisture threshold
          }
        }
      }
    `,
  ],
})
export class AlertDashboardComponent {
  /** History stays collapsed until asked for — the live picture comes first. */
  readonly showHistory = signal(false);

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
  ) {}
}

/** A crossed threshold reads as 0 rather than a confusing negative distance. */
function formatGap(value: number | undefined): string {
  if (value === undefined) return '?';
  return String(Math.max(0, Math.round(value * 10) / 10));
}
