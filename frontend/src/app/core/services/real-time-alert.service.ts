/**
 * RealTimeAlertService — the client side of the alert pipeline.
 *
 * Connects to the NestJS Socket.IO gateway (same origin: nginx proxies
 * /socket.io in production, the Angular dev-server proxy in development) and
 * converts incoming WebSocket events into RxJS streams — the idiomatic
 * Angular way to fan pushed data out to any number of components.
 *
 * Exposed streams:
 *   - anomalies$      every broadcast alert (ELEVATED + CRITICAL), for the map
 *   - criticalAlerts$ only CRITICAL_PHOSPHORUS_FIRE escalations
 *   - activeWarnings$ stateful, newest-first list of unacknowledged criticals
 *   - connected$      live gateway connectivity, for the status indicator
 *
 * Socket.IO reconnects with backoff automatically, so a backend redeploy
 * self-heals without any code here.
 */

import { Injectable, NgZone, OnDestroy, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';

import { AnomalyAlert, ServerToClientEvents } from '../models/alert.model';
import { OperatorKeyService } from './operator-key.service';

/** Thrown by `acknowledge` when this tab has no operator key. */
export const LOCKED = 'locked';

/** Upper bound on the retained warning list — a dashboard, not a database. */
const MAX_ACTIVE_WARNINGS = 50;

@Injectable({ providedIn: 'root' })
export class RealTimeAlertService implements OnDestroy {
  private readonly socket: Socket<ServerToClientEvents>;

  // Subjects stay private; consumers only ever see read-only Observables.
  private readonly anomalySubject = new Subject<AnomalyAlert>();
  private readonly criticalSubject = new Subject<AnomalyAlert>();
  private readonly warningsSubject = new BehaviorSubject<AnomalyAlert[]>([]);
  private readonly historySubject = new BehaviorSubject<AnomalyAlert[]>([]);
  private readonly connectedSubject = new BehaviorSubject<boolean>(false);

  /** Every broadcast alert — feeds the anomaly layer on the map. */
  readonly anomalies$: Observable<AnomalyAlert> = this.anomalySubject.asObservable();
  /** Only CRITICAL_PHOSPHORUS_FIRE — feeds markers and audible/visual alarms. */
  readonly criticalAlerts$: Observable<AnomalyAlert> = this.criticalSubject.asObservable();
  /** Current unacknowledged critical warnings, newest first. */
  readonly activeWarnings$: Observable<AnomalyAlert[]> = this.warningsSubject.asObservable();
  /** Recent evaluations of every level, loaded once from the REST history. */
  readonly history$: Observable<AnomalyAlert[]> = this.historySubject.asObservable();
  /** Gateway connectivity (drives the dashboard status chip). */
  readonly connected$: Observable<boolean> = this.connectedSubject.asObservable();

  private readonly operatorKey = inject(OperatorKeyService);

  constructor(private readonly zone: NgZone) {
    // Connect OUTSIDE Angular's zone so Socket.IO heartbeats never trigger
    // change detection; handlers re-enter the zone only for real data.
    this.socket = this.zone.runOutsideAngular(() =>
      io({ transports: ['websocket'] }),
    );

    this.socket.on('connect', () =>
      this.zone.run(() => this.connectedSubject.next(true)),
    );
    this.socket.on('disconnect', () =>
      this.zone.run(() => this.connectedSubject.next(false)),
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
        fetch('/api/alerts?limit=100&sinceHours=168').then((r) =>
          r.ok ? (r.json() as Promise<AnomalyAlert[]>) : [],
        ),
        // Only what is still outstanding: an alert somebody already took must
        // not come back as an active warning on the next page load.
        fetch(
          '/api/alerts?limit=50&sinceHours=24&criticalOnly=true&unacknowledgedOnly=true',
        ).then((r) => (r.ok ? (r.json() as Promise<AnomalyAlert[]>) : [])),
      ]);
      this.historySubject.next(recent);
      // Older first, so pushWarning's newest-first ordering comes out right.
      [...criticals].reverse().forEach((alert) => this.pushWarning(alert));
    } catch {
      // History is a convenience; live alerts work without it.
    }
  }

  /**
   * Synchronous snapshots of the two subjects the collapsed mobile sheet
   * summarises in one line.
   *
   * The streams above stay the interface for anything that renders a list;
   * these exist because a summary is computed inside a template expression,
   * and piping an Observable through `*ngIf ... as` there would hand change
   * detection a fresh object on every pass.
   */
  get activeWarnings(): readonly AnomalyAlert[] {
    return this.warningsSubject.value;
  }

  get isConnected(): boolean {
    return this.connectedSubject.value;
  }

  /**
   * Record that a responder has taken this alert.
   *
   * Guarded by the operator key, and deliberately so: this deployment is on
   * the open internet and an acknowledgement now clears the alarm for
   * everyone, so it cannot be something a passer-by can do.
   *
   * The list is not touched here — the server answers, then broadcasts, and
   * this tab clears the alarm from that broadcast like every other client.
   * Removing it optimistically would show a responder an alarm as handled
   * that the record still holds open.
   */
  async acknowledge(alertId: number): Promise<void> {
    const key = this.operatorKey.read();
    if (!key) throw new Error(LOCKED);

    const response = await fetch(`/api/alerts/${alertId}/acknowledge`, {
      method: 'POST',
      headers: { 'X-API-Key': key },
    });
    if (response.ok) return;

    if (response.status === 401 || response.status === 503) {
      this.operatorKey.clear();
      throw new Error(LOCKED);
    }
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(body?.message ?? `HTTP ${response.status}`);
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
    const key = this.operatorKey.read();
    if (!key) throw new Error(LOCKED);

    const response = await fetch(`/api/alerts/${alertId}/outcome`, {
      method: 'POST',
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome }),
    });
    if (response.ok) {
      await this.loadHistory();
      return;
    }
    if (response.status === 401 || response.status === 503) {
      this.operatorKey.clear();
      throw new Error(LOCKED);
    }
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(body?.message ?? `HTTP ${response.status}`);
  }

  /** Drop an acknowledged alert from the active list and stamp the history. */
  private applyAcknowledgement(alertId: number, acknowledgedAt: string): void {
    this.warningsSubject.next(
      this.warningsSubject.value.filter((warning) => warning.id !== alertId),
    );
    this.historySubject.next(
      this.historySubject.value.map((entry) =>
        entry.id === alertId ? { ...entry, acknowledgedAt } : entry,
      ),
    );
  }

  /** Prepend a warning, dedupe by anomaly id, cap the list length. */
  private pushWarning(alert: AnomalyAlert): void {
    // A restored history entry may already carry an acknowledgement; it
    // belongs in the record, not in the list of what is still outstanding.
    if (alert.acknowledgedAt) return;

    this.historySubject.next(
      [alert, ...this.historySubject.value.filter((h) => h.id !== alert.id)].slice(0, 100),
    );
    const withoutDuplicate = this.warningsSubject.value.filter(
      (warning) => warning.id !== alert.id,
    );
    this.warningsSubject.next(
      [alert, ...withoutDuplicate].slice(0, MAX_ACTIVE_WARNINGS),
    );
  }

  ngOnDestroy(): void {
    this.socket.disconnect();
    this.anomalySubject.complete();
    this.criticalSubject.complete();
    this.warningsSubject.complete();
    this.historySubject.complete();
    this.connectedSubject.complete();
  }
}
