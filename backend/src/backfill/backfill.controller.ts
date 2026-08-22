import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { API_KEY_HEADER, ApiKeyGuard } from '../auth/api-key.guard';
import { StartBackfillDto } from './backfill.dto';
import { BackfillRun, BackfillService } from './backfill.service';

@ApiTags('backfill')
@Controller('backfill/satellite')
export class BackfillController {
  constructor(private readonly backfill: BackfillService) {}

  @Get()
  @ApiOperation({
    summary: 'Satellite archive backfill runs, newest first',
    description:
      'Each run replays a date range of NASA FIRMS detections through the ' +
      'live evaluation rule, marked as history: stored and counted by the ' +
      'incident register, never alarmed. `coverageGaps` lists days no ' +
      'product covered — absence of rows there is not absence of fires.',
  })
  @ApiOkResponse({ description: 'Up to the last 50 runs with their progress.' })
  list(): Promise<BackfillRun[]> {
    return this.backfill.list();
  }

  @Post()
  @HttpCode(202)
  @UseGuards(ApiKeyGuard)
  @ApiHeader({ name: API_KEY_HEADER, required: true })
  @ApiOperation({
    summary: 'Start a satellite archive backfill for a date range',
    description:
      'Operator only. One run at a time; the range must lie within the ' +
      'archive (from 2012-01-20), not in the future, and span at most five ' +
      'years. Progress is readable from GET while the workers run it.',
  })
  @ApiAcceptedResponse({ description: 'The run, queued.' })
  @ApiBadRequestResponse({ description: 'Range inverted, future, too long, or before the archive.' })
  @ApiConflictResponse({ description: 'A run is already queued or running.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid operator key.' })
  start(@Body() body: StartBackfillDto): Promise<BackfillRun> {
    return this.backfill.start(body.from, body.to);
  }
}
