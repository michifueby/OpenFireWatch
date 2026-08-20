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
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
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
