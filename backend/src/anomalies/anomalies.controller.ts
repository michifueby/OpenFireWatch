import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AnomaliesService } from './anomalies.service';
import { QueryAnomaliesDto } from './query-anomalies.dto';

@ApiTags('anomalies')
@Controller('anomalies')
export class AnomaliesController {
  constructor(private readonly anomalies: AnomaliesService) {}

  @Get()
  @ApiOperation({ summary: 'Recent thermal anomalies as GeoJSON' })
  @ApiOkResponse({ description: 'A GeoJSON FeatureCollection of anomaly points' })
  find(@Query() query: QueryAnomaliesDto): Promise<unknown> {
    // The DTO arrives fully validated & type-coerced by the global pipe.
    return this.anomalies.findAsGeoJson(query);
  }
}
