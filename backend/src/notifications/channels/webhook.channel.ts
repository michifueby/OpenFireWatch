/**
 * WebhookChannel — the generic escape hatch.
 *
 * POSTs the notification as JSON to a URL of the operator's choosing. This is
 * what makes the system reach anything at all: a fire brigade's own alerting,
 * a Slack or Mattermost incoming hook, an email relay, a Node-RED flow, a
 * script on somebody's server. Channels for specific services exist because
 * they are convenient, not because they are necessary.
 *
 * Signed with HMAC-SHA256 when a secret is configured, so the receiver can
 * tell a genuine notification from anybody who guessed the URL. The signature
 * covers the exact bytes sent, and the timestamp is inside the signed payload
 * so an old capture cannot be replayed as current news.
 */

import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';

import { NotificationChannel } from '../notification-channel';
import { Notification } from '../notification.model';

@Injectable()
export class WebhookChannel implements NotificationChannel {
  readonly name = 'webhook';

  isConfigured(): boolean {
    return !!process.env.NOTIFY_WEBHOOK_URL?.trim();
  }

  async send(notification: Notification): Promise<void> {
    const url = process.env.NOTIFY_WEBHOOK_URL!.trim();
    const secret = process.env.NOTIFY_WEBHOOK_SECRET?.trim();

    // Serialised once and sent verbatim: signing a different string than the
    // one on the wire is the classic way to build a signature nobody can
    // verify.
    const payload = JSON.stringify({
      source: 'openfirewatch',
      kind: notification.kind,
      severity: notification.severity,
      title: notification.title,
      body: notification.body,
      url: notification.url,
      occurredAt: notification.occurredAt,
      data: notification.data,
    });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) {
      headers['X-OpenFireWatch-Signature'] =
        'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: payload,
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 200);
        throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
