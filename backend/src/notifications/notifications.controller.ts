import { Inject, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { APP_CONFIG, AppConfig } from '../config/environment';
import { API_KEY_HEADER, ApiKeyGuard } from '../auth/api-key.guard';
import { testText } from './notification-texts';
import { NotificationService } from './notification.service';

/**
 * Which channels are configured, and a way to prove they work.
 *
 * The test endpoint exists because the alternative is waiting for a real
 * emergency to discover that the chat id was wrong. It carries the operator
 * key: a public button that sends a message to the fire brigade's phones
 * would be a way to harass them.
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('channels')
  @ApiOperation({ summary: 'Which delivery channels exist and are configured' })
  @ApiOkResponse({ description: 'Channel names with their configured state.' })
  channels(): { name: string; configured: boolean }[] {
    return this.notifications.describeChannels();
  }

  @Post('test')
  @HttpCode(202)
  @UseGuards(ApiKeyGuard)
  @ApiHeader({ name: API_KEY_HEADER, required: true })
  @ApiOperation({
    summary: 'Send a test notification through every configured channel',
    description:
      'Bypasses deduplication so it can be pressed repeatedly while fixing a ' +
      'configuration.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid operator key.' })
  async test(): Promise<{ dispatchedTo: string[] }> {
    const channels = this.notifications.configuredChannels().map((c) => c.name);
    await this.notifications.notify({
      kind: 'test',
      severity: 'critical', // must pass any severity floor, or the test lies
      dedupeKey: `test:${Date.now()}`,
      ...testText(),
      data: { test: true },
      url: this.config.api.publicUrl,
      occurredAt: new Date().toISOString(),
    });
    return { dispatchedTo: channels };
  }
}
