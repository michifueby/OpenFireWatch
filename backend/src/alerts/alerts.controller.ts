import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { API_KEY_HEADER, ApiKeyGuard } from '../auth/api-key.guard';
import { AlertHistoryEntry, AlertHistoryService } from './alert-history.service';
import { AlertsGateway } from './alerts.gateway';
import { QueryAlertsDto } from './query-alerts.dto';

/**
 * Past evaluations. Reads are public, like every other read: a situation
 * picture is meant to be looked at.
 *
 * Acknowledging is not. This deployment is on the open internet, and an
 * acknowledgement now clears the alarm for everyone — so without the guard,
 * any passer-by could silence a warning for the crew that depends on it.
 */
@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly history: AlertHistoryService,
    private readonly gateway: AlertsGateway,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Recent evaluated alerts, newest first' })
  @ApiOkResponse({
    description:
      'Entries shaped like the live WebSocket payload, plus evaluatedAt and acknowledgedAt.',
  })
  find(@Query() query: QueryAlertsDto): Promise<AlertHistoryEntry[]> {
    return this.history.find(query);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  @UseGuards(ApiKeyGuard)
  @ApiHeader({ name: API_KEY_HEADER, required: true })
  @ApiOperation({
    summary: 'Record that a responder has taken this alert',
    description:
      'Keyed by anomaly id — the id carried in the alert payload. Idempotent: ' +
      'acknowledging twice returns the first timestamp rather than failing.',
  })
  @ApiOkResponse({ description: 'When the alert was acknowledged.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid operator key.' })
  @ApiNotFoundResponse({ description: 'No evaluated alert with that id.' })
  async acknowledge(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ id: number; acknowledgedAt: string }> {
    const { acknowledgedAt } = await this.history.acknowledge(id);
    const event = { id, acknowledgedAt };
    // Announced only after the database has accepted it: a responder must
    // never see an alarm clear on screen that is still outstanding in the
    // record everyone else will load on their next visit.
    await this.gateway.announceAcknowledgement(event);
    return event;
  }
}
