import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { HistoryService, ZoneHistory } from './history.service';

/**
 * Public, like every other read — and this one especially: it is the part of
 * the system meant to be quoted in a report somebody else will check.
 */
@ApiTags('history')
@Controller('history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get('ignition-windows')
  @ApiOperation({
    summary: 'How often each zone has met its ignition criteria, by season',
    description:
      'Applies the live thresholds to a decade of hourly reanalysis weather. ' +
      'Both criteria must be met in the same hour for that hour to count.',
  })
  @ApiOkResponse({ description: 'Per-zone ignition-window days by year and month.' })
  summary(): Promise<{ zones: ZoneHistory[]; generatedAt: string }> {
    return this.history.summary();
  }
}
