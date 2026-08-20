import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ConditionsService, CurrentConditions } from './conditions.service';

@ApiTags('conditions')
@Controller('conditions')
export class ConditionsController {
  constructor(private readonly conditions: ConditionsService) {}

  @Get()
  @ApiOperation({
    summary: 'Current ground conditions and how close each zone is to escalating',
  })
  @ApiOkResponse({
    description:
      'Area-wide weather from the latest ingestion cycle, plus a per-zone ' +
      'readiness assessment. `available: false` means no cycle has reported ' +
      'recently — the values are absent rather than stale.',
  })
  current(): Promise<CurrentConditions> {
    return this.conditions.current();
  }
}
