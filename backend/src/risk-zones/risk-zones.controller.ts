import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { API_KEY_HEADER, ApiKeyGuard } from '../auth/api-key.guard';
import { CreateRiskZoneDto, UpdateRiskZoneDto } from './risk-zone.dto';
import { RiskZoneService } from './risk-zone.service';

/**
 * Hazard-zone management.
 *
 * Reading is public — a situation map is meant to be watched. Every write is
 * guarded by the operator API key, because zones decide whether an alert is
 * raised at all.
 */
@ApiTags('risk-zones')
@Controller('risk-zones')
export class RiskZonesController {
  constructor(private readonly riskZones: RiskZoneService) {}

  @Get()
  @ApiOperation({ summary: 'Active high-risk zones as GeoJSON (public)' })
  @ApiOkResponse({
    description:
      'A GeoJSON FeatureCollection of Polygon features. Each feature carries ' +
      'id, hazardType and a per-language name object ({ en, de }).',
  })
  find(): Promise<unknown> {
    return this.riskZones.findAllAsGeoJson();
  }

  @Post()
  @UseGuards(ApiKeyGuard)
  @ApiHeader({ name: API_KEY_HEADER, description: 'Operator API key', required: true })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid API key' })
  @ApiOperation({ summary: 'Create a hazard zone' })
  create(@Body() body: CreateRiskZoneDto): Promise<{ id: number }> {
    return this.riskZones.create(body);
  }

  @Put(':id')
  @UseGuards(ApiKeyGuard)
  @HttpCode(204)
  @ApiHeader({ name: API_KEY_HEADER, description: 'Operator API key', required: true })
  @ApiOperation({ summary: 'Replace a hazard zone' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateRiskZoneDto,
  ): Promise<void> {
    return this.riskZones.update(id, body);
  }

  @Delete(':id')
  @UseGuards(ApiKeyGuard)
  @HttpCode(204)
  @ApiHeader({ name: API_KEY_HEADER, description: 'Operator API key', required: true })
  @ApiOperation({
    summary: 'Retire a hazard zone (deactivates it; history is preserved)',
  })
  retire(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.riskZones.deactivate(id);
  }
}
