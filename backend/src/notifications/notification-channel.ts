/**
 * The contract every delivery channel implements.
 *
 * Everything a channel needs to be is here: a name, a way to say whether this
 * deployment configured it, and a way to send. No base class, no lifecycle, no
 * registration call — a new channel is one file that implements this and one
 * line in the module's providers.
 */

import { Notification } from './notification.model';

export interface NotificationChannel {
  /** Short, stable identifier. Appears in logs and the delivery record. */
  readonly name: string;

  /**
   * Whether this deployment has configured the channel.
   *
   * An unconfigured channel is skipped silently rather than failing: most
   * deployments will use one or two, and treating "not set up" as an error
   * would fill the log with noise about a decision somebody already made.
   */
  isConfigured(): boolean;

  /**
   * Deliver, or throw.
   *
   * Throwing is the correct way to report failure — the dispatcher retries,
   * records the reason, and carries on with the other channels. A channel
   * that swallows its own errors turns a silent outage into an invisible one.
   */
  send(notification: Notification): Promise<void>;
}

/**
 * Injection token for the channel list. A multi-provider, so channels are
 * collected rather than enumerated anywhere: the dispatcher never learns how
 * many there are or what they do.
 */
export const NOTIFICATION_CHANNELS = Symbol('NOTIFICATION_CHANNELS');

/**
 * Shared helper: every channel talks to some HTTP endpoint, and every one of
 * them must bound how long it is willing to wait. Without a timeout a hung
 * chat API would hold a delivery attempt open until the process restarts.
 */
export async function postJson(
  url: string,
  body: unknown,
  init: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 10_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...init.headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      // The body usually names the actual problem ("chat not found", "bad
      // token"); a bare status code would send somebody guessing.
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
