/**
 * Sensor intake and status.
 *
 * POST /api/sensors/readings is what a LoRaWAN network server's webhook
 * points at. It accepts either our canonical batch shape or a TTN-style
 * uplink envelope directly — see normaliseIntakeBody — so wiring a gateway up
 * is a form in the network server's UI, not a relay service.
 *
 * GET /api/sensors is public like every other read: which sensors exist,
 * where they stand, whether they are still reporting, and what they measure.
 *
 * Managing the registry (register / edit / retire) is operator work and
 * carries the OPERATOR key — not the gateway token, which exists so that the
 * box forwarding readings can do nothing but forward readings.
 */

import {
  BadRequestException,
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
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { API_KEY_HEADER, ApiKeyGuard } from '../auth/api-key.guard';
import { RegisterSensorDto } from './register-sensor.dto';
import { SensorIngestGuard, SENSOR_TOKEN_HEADER } from './sensor-ingest.guard';
import { normaliseIntakeBody, SensorReadingDto } from './sensor-reading.dto';
import { SensorService, SensorStatus } from './sensor.service';

@ApiTags('sensors')
@Controller('sensors')
export class SensorsController {
  constructor(private readonly sensors: SensorService) {}

  @Get()
  @ApiOperation({ summary: 'Registered ground sensors and their latest state' })
  @ApiOkResponse({ description: 'Sensors with calibrated latest readings.' })
  findAll(): Promise<SensorStatus[]> {
    return this.sensors.findAll();
  }

  @Post()
  @HttpCode(201)
  @UseGuards(ApiKeyGuard)
  @ApiHeader({ name: API_KEY_HEADER, required: true })
  @ApiOperation({
    summary: 'Register a ground sensor',
    description:
      'Re-registering a retired device id re-activates it with the new ' +
      'details; an active duplicate is refused with 409.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid operator key.' })
  register(@Body() dto: RegisterSensorDto): Promise<{ id: number }> {
    return this.sensors.register(dto);
  }

  @Put(':id')
  @HttpCode(204)
  @UseGuards(ApiKeyGuard)
  @ApiHeader({ name: API_KEY_HEADER, required: true })
  @ApiOperation({ summary: 'Edit a registered sensor' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RegisterSensorDto,
  ): Promise<void> {
    return this.sensors.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(ApiKeyGuard)
  @ApiHeader({ name: API_KEY_HEADER, required: true })
  @ApiOperation({
    summary: 'Retire a sensor',
    description: 'Deactivates it; its readings are kept as the site record.',
  })
  retire(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.sensors.retire(id);
  }

  @Post('readings')
  @HttpCode(202)
  @UseGuards(SensorIngestGuard)
  @ApiHeader({ name: SENSOR_TOKEN_HEADER, required: true })
  @ApiOperation({
    summary: 'Ingest ground sensor readings',
    description:
      'Accepts {readings: [...]}, a single reading, or a LoRaWAN (TTN v3) ' +
      'uplink envelope. Unregistered device ids are reported, not stored.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid sensor token.' })
  async ingest(
    @Body() body: unknown,
  ): Promise<{ accepted: number; unknownDevices: string[] }> {
    const readings = normaliseIntakeBody(body);
    if (!readings || readings.length === 0) {
      throw new BadRequestException(
        'Body must be {readings: [...]}, a single reading, or a LoRaWAN uplink ' +
          'whose decoded_payload carries temperatureC/soilMoisturePct.',
      );
    }

    // Validated explicitly because the endpoint accepts three shapes: the
    // global ValidationPipe cannot know which one arrived, but every shape
    // must end as a valid SensorReadingDto before it touches the database.
    const unknownDevices: string[] = [];
    let accepted = 0;
    for (const raw of readings) {
      const reading = plainToInstance(SensorReadingDto, raw);
      const errors = await validate(reading);
      if (errors.length > 0) {
        throw new BadRequestException(
          errors.flatMap((e) => Object.values(e.constraints ?? {})),
        );
      }
      if (await this.sensors.record(reading)) accepted += 1;
      else if (!unknownDevices.includes(reading.deviceId)) {
        unknownDevices.push(reading.deviceId);
      }
    }
    return { accepted, unknownDevices };
  }
}
