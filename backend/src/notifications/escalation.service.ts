/**
 * EscalationService — the second nudge, for the alert nobody took.
 *
 * A notification proves delivery to a phone, not to a person. At three in
 * the morning the first message can sit unread next to a sleeping responder,
 * and the system would count that as "warned". Acknowledgement is the only
 * signal that a HUMAN has the alert — so its absence, after enough time, is
 * itself worth announcing.
 *
 * Deliberately the simplest honest form: one reminder per alert, to the same
 * channels, after a configurable delay. Who to try NEXT — a second person, a
 * different number — is an operational decision that belongs to the crew,
 * not to this code; the seam for it is this service.
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import { NotificationService } from './notification.service';

/** How often to look. The delay itself decides when a reminder is due. */
const SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * Reminders stop making sense after a while: an alert twelve hours old is a
 * matter for the morning review, not for a third ping at dawn.
 */
const MAX_AGE_HOURS = 12;

@Injectable()
export class EscalationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EscalationService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    if (this.delayMinutes() <= 0) {
      this.logger.log('Escalation disabled (NOTIFY_ESCALATE_MINUTES=0).');
      return;
    }
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
  }

  /** Read per sweep, so a redeploy with a new value needs no restart logic. */
  private delayMinutes(): number {
    const parsed = Number(process.env.NOTIFY_ESCALATE_MINUTES ?? 15);
    return Number.isFinite(parsed) ? parsed : 15;
  }

  /**
   * Public rather than private-and-timer-only: the test suite drives it
   * directly, because "wait a quarter of an hour" is not a test.
   */
  async sweep(): Promise<void> {
    const delay = this.delayMinutes();
    if (delay <= 0) return;

    try {
      const { rows } = await this.db.query<{
        anomaly_id: string;
        alert_level: string;
        evaluated_at: Date;
        latitude: number;
        longitude: number;
        name: string | null;
        name_de: string | null;
      }>(
        `
        SELECT ve.anomaly_id, ve.alert_level, ve.evaluated_at,
               ST_Y(a.geom) AS latitude, ST_X(a.geom) AS longitude,
               z.name, z.name_de
          FROM validated_events ve
          JOIN thermal_anomalies a ON a.id = ve.anomaly_id
          LEFT JOIN high_risk_zones z ON z.id = ve.zone_id
         WHERE ve.alert_level LIKE 'CRITICAL%'
           AND ve.acknowledged_at IS NULL
           AND ve.evaluated_at <  now() - ($1 || ' minutes')::interval
           AND ve.evaluated_at >= now() - interval '${MAX_AGE_HOURS} hours'
         ORDER BY ve.evaluated_at;
        `,
        [delay],
      );

      for (const row of rows) {
        const minutes = Math.round(
          (Date.now() - row.evaluated_at.getTime()) / 60_000,
        );
        await this.notifications.notify({
          kind: 'alert.unacknowledged',
          severity: 'critical',
          // Keyed on the alert alone: one reminder, ever. Repeating it every
          // sweep is how a channel gets muted, and a muted channel warns
          // nobody — the dedupe store enforces the "once".
          dedupeKey: `escalate:${row.anomaly_id}`,
          title: `Unquittierter Alarm — seit ${minutes} Minuten`,
          body: [
            `Alarm #${row.anomaly_id} (${row.alert_level}) wurde vor`,
            `${minutes} Minuten gemeldet und bisher von niemandem übernommen.`,
            '',
            `Zone: ${row.name_de ?? row.name ?? 'außerhalb aller Zonen'}`,
            `Koordinaten: ${row.latitude.toFixed(4)}, ${row.longitude.toFixed(4)}`,
            '',
            'Übernehmen heißt: QUITT auf der Karte drücken.',
            'Kein Ersatz für den Notruf 122.',
          ].join('\n'),
          data: {
            anomalyId: Number(row.anomaly_id),
            level: row.alert_level,
            evaluatedAt: row.evaluated_at.toISOString(),
            unacknowledgedForMinutes: minutes,
          },
          url: process.env.PUBLIC_URL?.trim() || 'https://openfirewatch.org',
          occurredAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      this.logger.warn(`Escalation sweep failed: ${(error as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
