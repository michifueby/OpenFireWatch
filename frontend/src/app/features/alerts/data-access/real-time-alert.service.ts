/**
 * RealTimeAlertService — the client side of the alert pipeline.
 *
 * Connects to the NestJS Socket.IO gateway (same origin: nginx proxies
 * /socket.io in production, the Angular dev-server proxy in development) and
 * converts incoming WebSocket events into RxJS streams — the idiomatic
 * Angular way to fan pushed data out to any number of components.
 *
 * What it exposes:
 *   - anomalies$      every broadcast alert (ELEVATED + CRITICAL), for the map
 *   - criticalAlerts$ every critical escalation, as an event
 *   - activeWarnings  signal: unacknowledged criticals, newest first
 *   - history         signal: recent evaluations of every level
 *   - connected       signal: live gateway connectivity
 *
 * Socket.IO reconnects with backoff automatically, so a backend redeploy
 * self-heals without any code here.
 */

import { Injectable, NgZone, OnDestroy, inject, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';

import { ApiClient } from '@core/api/api-client';
import { AnomalyAlert, ServerToClientEvents } from '@core/models/alert.model';

/** Upper bound on the retained warning list — a dashboard, not a database. */
const MAX_ACTIVE_WARNINGS = 50;

@Injectable({ providedIn: 'root' })
export class RealTimeAlertService implements OnDestroy {
  private readonly socket: Socket<ServerToClientEvents>;

  // Events stay Subjects; state became signals.
  //
  // The distinction is not cosmetic. `anomalies$` and `criticalAlerts$` are
  // things that HAPPEN — a subscriber wants each occurrence, and the map's
  // camera must react to the arrival of an alert, not to the fact that one
  // exists. The other three are things that ARE: what is outstanding, what
  // the record holds, whether the gateway is up. A template asking a
  // question like that wants the current answer, which is what a signal is.
  //
  // It also removes a wart: two synchronous getters existed purely so the
  // collapsed mobile sheet could read a BehaviorSubject's value inside a
  // template expression.
  private readonly anomalySubject = new Subject<AnomalyAlert>();
  private readonly criticalSubject = new Subject<AnomalyAlert>();

  /** Every broadcast alert — feeds the anomaly layer on the map. */
  readonly anomalies$: Observable<AnomalyAlert> = this.anomalySubject.asObservable();
  /** Every critical escalation — feeds markers and the camera. */
  readonly criticalAlerts$: Observable<AnomalyAlert> = this.criticalSubject.asObservable();

  /** Current unacknowledged critical warnings, newest first. */
  readonly activeWarnings = signal<readonly AnomalyAlert[]>([]);
  /** Recent evaluations of every level, loaded once from the REST history. */
  readonly history = signal<readonly AnomalyAlert[]>([]);
  /** Gateway connectivity (drives the dashboard status chip). */
  readonly connected = signal(false);

  private readonly api = inject(ApiClient);

  constructor(private readonly zone: NgZone) {
    // Connect OUTSIDE Angular's zone so Socket.IO heartbeats never trigger
    // change detection; handlers re-enter the zone only for real data.
    this.socket = this.zone.runOutsideAngular(() =>
      io({ transports: ['websocket'] }),
    );

    this.socket.on('connect', () =>
      this.zone.run(() => this.connected.set(true)),
    );
    this.socket.on('disconnect', () =>
      this.zone.run(() => this.connected.set(false)),
    );

    // General feed: everything the backend considered broadcast-worthy.
    this.socket.on('anomaly:new', (alert) =>
      this.zone.run(() => this.anomalySubject.next(alert)),
    );

    // Life-safety feed: ONE event for every critical level. Subscribing per
    // level would silently miss any hazard type added later.
    this.socket.on('alert:critical', (alert) =>
      this.zone.run(() => {
        this.criticalSubject.next(alert);
        this.pushWarning(alert);
      }),
    );

    // Acknowledgements arrive the same way alerts do, including the ones this
    // tab made itself. One code path clears the alarm everywhere, so two
    // responders on two devices cannot end up looking at different pictures.
    this.socket.on('alert:acknowledged', (event) =>
      this.zone.run(() => this.applyAcknowledgement(event.id, event.acknowledgedAt)),
    );

    void this.loadHistory();
  }

  /**
   * Seed from the REST history so a page reload does not blank the picture.
   *
   * Until this existed, an alert only lived in the browser tab that happened
   * to be open when it fired — the database had every verdict, and the UI
   * showed none of it after F5.
   */
  async loadHistory(): Promise<void> {
    try {
      const [recent, criticals] = await Promise.all([
        this.api.get<AnomalyAlert[]>('/api/alerts?limit=100&sinceHours=168'),
        // Only what is still outstanding: an alert somebody already took must
        // not come back as an active warning on the next page load.
        this.api.get<AnomalyAlert[]>(
          '/api/alerts?limit=50&sinceHours=24&criticalOnly=true&unacknowledgedOnly=true',
        ),
      ]);
      this.history.set(recent);
      // Older first, so pushWarning's newest-first ordering comes out right.
      [...criticals].reverse().forEach((alert) => this.pushWarning(alert));
    } catch {
      // History is a convenience; live alerts work without it.
    }
  }

  /**
   * Record that a responder has taken this alert.
   *
   * Guarded by the operator key — attached by the interceptor — and
   * deliberately so: this deployment is on the open internet and an
   * acknowledgement clears the alarm for everyone, so it cannot be something
   * a passer-by can do.
   *
   * The list is not touched here — the server answers, then broadcasts, and
   * this tab clears the alarm from that broadcast like every other client.
   * Removing it optimistically would show a responder an alarm as handled
   * that the record still holds open.
   */
  async acknowledge(alertId: number): Promise<void> {
    await this.api.post(`/api/alerts/${alertId}/acknowledge`);
  }

  /**
   * Record what the crew found. Same guard as acknowledging: it feeds the
   * validation statistics, so it cannot be something a passer-by can set.
   * On success the history is reloaded — the record is the truth, not the
   * local array.
   */
  async setOutcome(
    alertId: number,
    outcome: 'confirmed' | 'nothing_found',
  ): Promise<void> {
    await this.api.post(`/api/alerts/${alertId}/outcome`, { outcome });
    await this.loadHistory();
  }

  /** Drop an acknowledged alert from the active list and stamp the history. */
  private applyAcknowledgement(alertId: number, acknowledgedAt: string): void {
    this.activeWarnings.update((warnings) =>
      warnings.filter((warning) => warning.id !== alertId),
    );
    this.history.update((entries) =>
      entries.map((entry) =>
        entry.id === alertId ? { ...entry, acknowledgedAt } : entry,
      ),
    );
  }

  /** Prepend a warning, dedupe by anomaly id, cap the list length. */
  private pushWarning(alert: AnomalyAlert): void {
    // A restored history entry may already carry an acknowledgement; it
    // belongs in the record, not in the list of what is still outstanding.
    if (alert.acknowledgedAt) return;

    this.history.update((entries) =>
      [alert, ...entries.filter((entry) => entry.id !== alert.id)].slice(0, 100),
    );
    this.activeWarnings.update((warnings) =>
      [alert, ...warnings.filter((warning) => warning.id !== alert.id)].slice(
        0,
        MAX_ACTIVE_WARNINGS,
      ),
    );
  }

  ngOnDestroy(): void {
    this.socket.disconnect();
    this.anomalySubject.complete();
    this.criticalSubject.complete();
  }
}
