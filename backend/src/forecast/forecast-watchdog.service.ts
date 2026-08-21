/**
 * ForecastWatchdog — turns a forecast into a warning somebody receives.
 *
 * A seven-day outlook nobody opens is a seven-day outlook nobody reads. The
 * point of running the ignition rule forwards is that a crew can act before
 * anything burns: walk the area, warn people using it, be on standby. That
 * only happens if the forecast reaches them.
 *
 * Announced once per window, when it comes within a horizon short enough to
 * be trustworthy and long enough to act on. A window six days out is worth
 * showing on screen but not worth waking somebody for: forecasts that far
 * ahead move, and a warning that is later withdrawn costs more credibility
 * than it buys attention.
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { NotificationService } from '../notifications/notification.service';
import { ForecastService, IgnitionWindow, ZoneForecast } from './forecast.service';

/** How far ahead a window is announced. Three days: plannable, still solid. */
const WARN_HORIZON_HOURS = Number(process.env.FORECAST_WARN_HOURS ?? 72);

/** Checked hourly, matching the rate at which the forecast itself changes. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class ForecastWatchdog implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ForecastWatchdog.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly forecast: ForecastService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    // Delayed on startup so the first ingestion cycle has a chance to publish
    // a forecast; checking immediately would only ever find nothing.
    setTimeout(() => void this.check(), 60_000).unref();
  }

  private async check(): Promise<void> {
    try {
      const snapshot = await this.forecast.current();
      if (!snapshot.available) return;

      for (const zone of snapshot.zones) {
        if (!zone.weatherGated) continue;
        for (const window of zone.windows) {
          const hoursAway = (Date.parse(window.from) - Date.now()) / 3_600_000;
          if (hoursAway < 0 || hoursAway > WARN_HORIZON_HOURS) continue;
          await this.announce(zone, window, hoursAway);
        }
      }
    } catch (error) {
      this.logger.warn(`Forecast check failed: ${(error as Error).message}`);
    }
  }

  private async announce(
    zone: ZoneForecast,
    window: IgnitionWindow,
    hoursAway: number,
  ): Promise<void> {
    const day = new Date(window.from).toLocaleDateString('de-AT', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
    });
    const from = window.from.slice(11, 16);
    const to = window.to.slice(11, 16);

    await this.notifications.notify({
      kind: 'forecast.ignition-window',
      // A forecast is not an event: it is a warning that there is still time
      // to act on, which is a different thing from an alarm.
      severity: 'warning',
      // Keyed on the window itself, so an hourly forecast refresh re-reports
      // nothing. A window that shifts to another hour is genuinely new news.
      dedupeKey: `forecast:${zone.zoneId}:${window.from}`,
      title: `Zündfenster erwartet — ${zone.name.de}`,
      body: [
        `${day}, ${from}–${to} Uhr werden in dieser Zone beide Bedingungen`,
        'für eine Selbstentzündung zugleich erfüllt:',
        '',
        `  Temperatur bis ${window.peakTemperatureC} °C`,
        `  Bodenfeuchte bis herunter auf ${window.minSoilMoisturePct} %`,
        '',
        `Vorlauf: rund ${Math.round(hoursAway)} Stunden.`,
        '',
        'Das ist eine Vorhersage, kein Brand. Sie schafft Zeit für Streife,',
        'Hinweise an Waldbesucher oder Bereitschaft.',
        '',
        'Kein Ersatz für den Notruf 122.',
      ].join('\n'),
      data: { zoneId: zone.zoneId, hazardType: zone.hazardType, window },
      url: process.env.PUBLIC_URL?.trim() || 'https://openfirewatch.org',
      occurredAt: new Date().toISOString(),
    });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
