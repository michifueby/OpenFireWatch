import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ForecastService, ForecastSnapshot } from './forecast.service';

/**
 * Public, like every other read. This is the part of the system a resident or
 * a duty officer would look at before anything has happened.
 */
@ApiTags('forecast')
@Controller('forecast')
export class ForecastController {
  constructor(private readonly forecast: ForecastService) {}

  @Get()
  @ApiOperation({
    summary: 'When each zone next meets its own ignition criteria',
    description:
      'Seven-day hourly outlook per weather-gated zone. `available: false` ' +
      'means no recent forecast cycle — not that no window is ahead.',
  })
  @ApiOkResponse({ description: 'Ignition windows per zone.' })
  current(): Promise<ForecastSnapshot> {
    return this.forecast.current();
  }
}
