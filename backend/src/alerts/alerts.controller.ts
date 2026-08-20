import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AlertHistoryEntry, AlertHistoryService } from './alert-history.service';
import { QueryAlertsDto } from './query-alerts.dto';

/**
 * Past evaluations. Public, like every other read: a situation picture is
 * meant to be looked at, and the write side is what needs protecting.
 */
@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly history: AlertHistoryService) {}

  @Get()
  @ApiOperation({ summary: 'Recent evaluated alerts, newest first' })
  @ApiOkResponse({
    description:
      'Entries shaped like the live WebSocket payload, plus evaluatedAt.',
  })
  find(@Query() query: QueryAlertsDto): Promise<AlertHistoryEntry[]> {
    return this.history.find(query);
  }
}
