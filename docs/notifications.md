# Notifications

An alert that only reaches a map reaches nobody at three in the morning —
which is when soil and air temperature are least likely to be watched and most
likely to matter. Notifications carry two things off the map:

- **Critical alerts.** Any `CRITICAL_*` escalation, once per anomaly.
- **A dead-man's switch.** If no ingestion cycle completes for several polling
  intervals, that is reported too, and so is the recovery. A warning system
  that dies quietly is worse than none, because people go on relying on it.

Nothing is sent unless a channel is configured. A fresh deployment notifies
nobody.

## Configuring a channel

Every channel is switched on solely by its own environment variables — see
`.env.example`. Two ship today.

### Webhook — the general way

```bash
NOTIFY_WEBHOOK_URL=https://example.org/openfirewatch
NOTIFY_WEBHOOK_SECRET=a-long-random-string   # optional, strongly recommended
```

A `POST` with this body:

```json
{
  "source": "openfirewatch",
  "kind": "alert.critical",
  "severity": "critical",
  "title": "Phosphorbrand — Föhrenwald (Steinfeld)",
  "body": "Zone: …\nTemperatur: 32 °C\n…",
  "url": "https://openfirewatch.org",
  "occurredAt": "2026-08-21T11:38:51.128Z",
  "data": { "id": 214, "latitude": 47.7593, "longitude": 16.2155, "…": "…" }
}
```

With a secret set, the header `X-OpenFireWatch-Signature: sha256=<hex>` carries
an HMAC-SHA256 over the exact request body. Verify it before trusting the
contents — the URL alone is not a secret:

```js
const expected = 'sha256=' + createHmac('sha256', SECRET).update(rawBody).digest('hex');
if (!timingSafeEqual(Buffer.from(expected), Buffer.from(received))) return reject();
```

This channel is what makes the system reach anything at all: an existing
alerting system, Slack or Mattermost, an email relay, a Node-RED flow, a
script. The service-specific channels exist because they are convenient, not
because they are necessary.

### Telegram — a message in the crew's group chat

```bash
NOTIFY_TELEGRAM_BOT_TOKEN=123456:ABC…
NOTIFY_TELEGRAM_CHAT_ID=-1001234567890
```

Free, on a phone in seconds, and a group means the whole crew sees the same
message. Create a bot with [@BotFather](https://t.me/botfather), add it to the
group, post once, then read the chat id from
`https://api.telegram.org/bot<TOKEN>/getUpdates`.

## Checking it works

Do not wait for an emergency to find out the chat id was wrong:

```bash
curl -X POST https://openfirewatch.org/api/notifications/test \
  -H "x-api-key: $OPERATOR_API_KEY"
```

It sends a clearly-marked test message through every configured channel and
returns which ones it reached. `GET /api/notifications/channels` lists every
channel and whether it is configured — that one is public, because it reveals
no more than which integrations exist.

## What stops a channel becoming noise

- **Deduplication by event, not by attempt.** The key for a critical alert is
  the anomaly id, so re-evaluating the same detection sends nothing further.
  Held in Redis, so two API replicas send one message between them, not two.
- **A severity floor.** `NOTIFY_MIN_SEVERITY=critical` delivers only critical
  alerts and stalls.
- **Transitions only.** A stall is announced once, not every five minutes, and
  the recovery is announced once.
- **Retries with backoff**, then a recorded failure. Delivery outcomes land in
  `notification_deliveries`, so *was anyone actually told?* has an answer that
  does not depend on having watched the log at the right moment:

```sql
SELECT created_at, kind, channel, status, error
  FROM notification_deliveries ORDER BY created_at DESC LIMIT 20;
```

## Adding a channel

The design goal is that a new channel touches nothing but itself. Write a
class implementing `NotificationChannel`
(`backend/src/notifications/notification-channel.ts`):

```ts
@Injectable()
export class SignalChannel implements NotificationChannel {
  readonly name = 'signal';

  isConfigured(): boolean {
    return !!process.env.NOTIFY_SIGNAL_URL?.trim();
  }

  async send(notification: Notification): Promise<void> {
    await postJson(process.env.NOTIFY_SIGNAL_URL!, {
      message: `${notification.title}\n\n${notification.body}`,
    });
    // Throw on failure. The dispatcher retries, records the reason and
    // carries on with the other channels; a channel that swallows its own
    // errors turns a silent outage into an invisible one.
  }
}
```

Then add it to `CHANNELS` in `notifications.module.ts`. That is the whole
change: the dispatcher receives channels as an injected array and never learns
what they are, so deduplication, retries, the severity floor, the delivery
record and the test endpoint all apply to the new one for free.

Adding a new *kind* of notification is the mirror image: extend
`NotificationKind`, call `notifications.notify({...})`, and every configured
channel carries it without modification. `NotificationKind` is a closed union
on purpose — a typo in a free-form string would silently stop delivering one
kind of alert, and that is the worst failure mode this system has.

## Deliberately not built yet

- **Escalation.** Nobody is notified a second time if the first message is not
  acknowledged. The state to build that on now exists — acknowledgements are
  recorded server-side — but who to escalate to, and after how long, is an
  operational question rather than a technical one.
- **Per-zone routing.** Every configured channel receives everything.
- **SMTP.** Deliberately absent: it would mean a mail dependency and
  credentials to keep, when a webhook to any relay does the same job. If real
  demand appears, it is one file — see above.

## What a notification is not

Every message ends with a reminder that it does not replace the emergency
number. This is not an approved alerting system: it has no guaranteed
availability, no response-time commitment, and no authority. It is a heads-up
to a person, not a dispatch.
