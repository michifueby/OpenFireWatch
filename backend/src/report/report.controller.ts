import { Controller, Get, Header, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { renderReport } from './report-pdf';
import { ReportService } from './report.service';

/**
 * Public, like every read: the report contains nothing the API does not
 * already serve — it is the same numbers, dated and on paper. Guarding it
 * would only guard the convenience.
 */
@ApiTags('report')
@Controller('report')
export class ReportController {
  constructor(private readonly report: ReportService) {}

  @Get('lagebericht.pdf')
  @Header('Content-Type', 'application/pdf')
  @ApiProduces('application/pdf')
  @ApiQuery({ name: 'lang', required: false, enum: ['de', 'en'] })
  @ApiOperation({
    summary: 'The situation report as a dated PDF',
    description:
      'Current conditions, open alerts, the ignition forecast, the seasonal ' +
      'record, the incident report card, sensors — and the limits, in the ' +
      'document itself. German by default (?lang=en for English).',
  })
  @ApiOkResponse({ description: 'A PDF, named with the generation date.' })
  async lagebericht(
    @Query('lang') lang: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const language = lang?.toLowerCase() === 'en' ? 'en' : 'de';
    const data = await this.report.collect();

    // Dated filename: reports get saved and forwarded, and three files named
    // "lagebericht.pdf" in one inbox are a guessing game.
    const day = data.generatedAt.slice(0, 10);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="openfirewatch-lagebericht-${day}.pdf"`,
    );
    // Always freshly generated; a cached situation report is a contradiction.
    res.setHeader('Cache-Control', 'no-store');

    // StreamableFile, not a bare Buffer: Nest would JSON-serialise a Buffer
    // return into {"type":"Buffer",...} despite the Content-Type header.
    return new StreamableFile(await renderReport(data, language));
  }
}
