import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { StatusService, SystemStatus } from './status.service';

@ApiTags('status')
@Controller('status')
export class StatusController {
  constructor(private readonly status: StatusService) {}

  @Get()
  @ApiOperation({
    summary: 'What the system is actually doing, feed by feed',
    description:
      'Which satellite products were asked in the last cycle and whether ' +
      'each answered, how old the weather, forecast and fire danger are, how ' +
      'many detections the record holds, sensor and dead-letter counts, and ' +
      'how far the satellite archive has been replayed. Every feed reports ' +
      'its own freshness: "missing" means nothing arrived, "stale" means it ' +
      'did but a while ago — quiet is not the same as not looking.',
  })
  @ApiOkResponse({ description: 'The current system status.' })
  current(): Promise<SystemStatus> {
    return this.status.current();
  }
}
