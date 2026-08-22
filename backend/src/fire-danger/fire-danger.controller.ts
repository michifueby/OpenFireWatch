import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { FireDangerService, FireDangerSnapshot } from './fire-danger.service';

@ApiTags('fire-danger')
@Controller('fire-danger')
export class FireDangerController {
  constructor(private readonly fireDanger: FireDangerService) {}

  @Get()
  @ApiOperation({
    summary: 'Fire danger (Canadian FWI) per zone: yesterday, today, the week ahead',
    description:
      'Computed by the workers with the Canadian Forest Fire Weather Index ' +
      'System — the method behind the EFFIS and national fire-danger maps — ' +
      'from Open-Meteo weather at each zone. `method` names it; the figure is ' +
      'not the published EFFIS value. `available: false` when the workers ' +
      'have not produced a snapshot recently.',
  })
  @ApiOkResponse({ description: 'The current fire danger snapshot.' })
  current(): Promise<FireDangerSnapshot> {
    return this.fireDanger.current();
  }
}
