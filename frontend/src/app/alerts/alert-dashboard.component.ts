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
import { Component } from '@angular/core';

import { TranslationService } from '../core/i18n/translation.service';
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
  ) {}
}
