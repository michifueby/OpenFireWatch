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
import { RegisterIncidentDto } from './incident.dto';
import {
  IncidentEntry,
  IncidentSummary,
  IncidentsService,
} from './incidents.service';

/**
 * The register of real events, and what it says about the system.
 *
 * Reads are public — this is precisely the material meant to be checked by
 * somebody else. Writes carry the operator key: the register feeds the
 * validation statistics, and letting anyone append events would let anyone
 * manufacture the system's own report card.
 */
@ApiTags('incidents')
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  @ApiOperation({
    summary: 'Recorded events, each validated against windows and alerts',
    description:
      'Every fire is checked against the ignition-window history and the ' +
      'alert record; the summary carries hit and false-alarm counts.',
  })
  @ApiOkResponse({ description: 'Incidents with validation, plus a summary.' })
  list(): Promise<{ incidents: IncidentEntry[]; summary: IncidentSummary }> {
    return this.incidents.list();
  }

  @Post()
  @HttpCode(201)
  @UseGuards(ApiKeyGuard)
  @ApiHeader({ name: API_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Record an event (may be years in the past)' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid operator key.' })
  create(@Body() dto: RegisterIncidentDto): Promise<{ id: number }> {
    return this.incidents.create(dto);
  }

  @Put(':id')
  @HttpCode(204)
  @UseGuards(ApiKeyGuard)
  @ApiHeader({ name: API_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Correct a recorded event' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RegisterIncidentDto,
  ): Promise<void> {
    return this.incidents.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(ApiKeyGuard)
  @ApiHeader({ name: API_KEY_HEADER, required: true })
  @ApiOperation({
    summary: 'Delete a recorded event',
    description:
      'A hard delete, unlike zones and sensors: nothing references an ' +
      'incident, and a wrong entry corrected beats a wrong entry kept.',
  })
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.incidents.remove(id);
  }
}
