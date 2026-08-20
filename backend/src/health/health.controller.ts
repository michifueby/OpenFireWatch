import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { APP_VERSION, GIT_REVISION } from '../version';

/**
 * Liveness probe used by the docker-compose healthcheck and orchestrators,
 * and the quickest way to ask a running deployment what it is.
 *
 * `status` deliberately still says nothing about whether data is arriving:
 * this answers "is the process up", not "is the system still watching". A
 * probe that conflated the two would report a stalled ingestion as healthy
 * or restart a perfectly good container because NASA had an outage.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness probe and build identity' })
  @ApiOkResponse({
    description: 'Process is up, with the release and commit it was built from.',
  })
  check(): { status: 'ok'; version: string; revision: string } {
    return { status: 'ok', version: APP_VERSION, revision: GIT_REVISION };
  }
}
