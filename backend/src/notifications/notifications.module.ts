/**
 * NotificationsModule — wiring, and the one place a new channel is registered.
 *
 * Adding a channel is two steps and touches nothing else:
 *   1. Write a class implementing NotificationChannel (see channels/).
 *   2. Add it to CHANNELS below.
 *
 * The dispatcher receives them as an injected array and never learns what
 * they are, so nothing downstream of this file has to change.
 */

import { Module } from '@nestjs/common';

import { TelegramChannel } from './channels/telegram.channel';
import { WebhookChannel } from './channels/webhook.channel';
import { IngestionWatchdog } from './ingestion-watchdog.service';
import { NOTIFICATION_CHANNELS } from './notification-channel';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';

/** Every known channel. Unconfigured ones are skipped at send time. */
const CHANNELS = [WebhookChannel, TelegramChannel];

@Module({
  controllers: [NotificationsController],
  providers: [
    ...CHANNELS,
    {
      provide: NOTIFICATION_CHANNELS,
      useFactory: (...channels: unknown[]) => channels,
      inject: CHANNELS,
    },
    NotificationService,
    IngestionWatchdog,
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}
