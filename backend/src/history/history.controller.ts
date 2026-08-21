import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';

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

  @Get('ignition-windows.csv')
  // The BOM is for German-locale Excel, which otherwise mangles umlauts in
  // zone names; every other consumer ignores it.
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="zuendfenster-tage.csv"')
  @ApiProduces('text/csv')
  @ApiOperation({
    summary: 'The same record as day-level CSV, for spreadsheets and reports',
  })
  async csv(): Promise<string> {
    return '\ufeff' + (await this.history.ignitionDaysCsv());
  }
}
