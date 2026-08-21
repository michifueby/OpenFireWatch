/**
 * What gets sent, independent of how.
 *
 * Channels receive this and decide what to do with it: a webhook forwards
 * `data` as JSON, a chat bot prints `title` and `body`, an SMS channel would
 * use `title` alone. Adding a channel therefore never requires touching the
 * things that produce notifications, and adding a notification never requires
 * touching the channels — which is the whole point of the split.
 */

/**
 * The kinds of thing worth waking somebody for.
 *
 * Deliberately a closed union rather than a free string: a typo in a channel
 * filter would otherwise silently stop delivering one kind of alert, and the
 * failure mode of a warning system that quietly stops warning is the worst
 * one it has.
 */
export type NotificationKind =
  /** An evaluation escalated to a CRITICAL_* level. */
  | 'alert.critical'
  /** No ingestion cycle has completed for longer than it should take. */
  | 'ingestion.stalled'
  /** Ingestion is running again after a stall. */
  | 'ingestion.recovered'
  /** The ignition rule, read forwards: conditions are coming, nothing burns yet. */
  | 'forecast.ignition-window'
  /** Somebody pressed the test button; proves the wiring end to end. */
  | 'test';

export type NotificationSeverity = 'critical' | 'warning' | 'info';

/** Ranked so a deployment can ask for "critical only" and mean it. */
export const SEVERITY_ORDER: Record<NotificationSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export interface Notification {
  kind: NotificationKind;
  severity: NotificationSeverity;

  /**
   * Stable identity of the *event*, not of the attempt.
   *
   * Two notifications with the same key are the same news: the satellite
   * reporting the same anomaly twice, or a stall that is still going on.
   * Delivery is suppressed for a while on this key, so a channel is never
   * asked to relay the same thing repeatedly — which is what turns an alerting
   * system into something people mute.
   */
  dedupeKey: string;

  /** One line. Some channels (SMS, push titles) will only ever show this. */
  title: string;

  /** A few lines of plain text. No markup: channels add their own. */
  body: string;

  /** The same facts in machine-readable form, for webhooks and archives. */
  data: Record<string, unknown>;

  /** Where a human should look. Included in every human-facing channel. */
  url?: string;

  occurredAt: string;
}
