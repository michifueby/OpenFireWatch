/**
 * TelegramChannel — a message in a chat the crew already has open.
 *
 * Chosen as the first concrete channel because it costs nothing, arrives on a
 * phone in seconds, works in a group so a whole crew sees the same thing, and
 * is set up in minutes with a bot token and a chat id. No SMTP server to run,
 * no SIM cards, no per-message fees.
 *
 * Setup: message @BotFather to create a bot and get the token, add the bot to
 * the group, then read the chat id from
 * https://api.telegram.org/bot<TOKEN>/getUpdates after posting once.
 */

import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, AppConfig } from '../../config/environment';
import { NotificationChannel, postJson } from '../notification-channel';
import { Notification } from '../notification.model';

/** Leading marker per severity — recognisable before a word is read. */
const MARKER: Record<Notification['severity'], string> = {
  critical: '🔴',
  warning: '🟠',
  info: '🔵',
};

@Injectable()
export class TelegramChannel implements NotificationChannel {
  readonly name = 'telegram';

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  isConfigured(): boolean {
    const { telegramBotToken, telegramChatId } = this.config.notifications;
    return !!telegramBotToken && !!telegramChatId;
  }

  async send(notification: Notification): Promise<void> {
    // Non-null: NotificationService only calls send() on a configured
    // channel, and isConfigured() above is what decides that.
    const token = this.config.notifications.telegramBotToken!;
    const chatId = this.config.notifications.telegramChatId!;

    const lines = [
      `${MARKER[notification.severity]} <b>${escapeHtml(notification.title)}</b>`,
      '',
      escapeHtml(notification.body),
    ];
    if (notification.url) lines.push('', escapeHtml(notification.url));

    await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: lines.join('\n'),
      parse_mode: 'HTML',
      // The map link would otherwise unfurl into a large preview and push the
      // actual message off a phone screen.
      disable_web_page_preview: true,
    });
  }
}

/**
 * Telegram's HTML mode rejects a message containing a stray `<` or `&`, so an
 * unescaped zone name with an ampersand in it would silently stop every
 * notification for that zone.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
