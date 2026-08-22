/**
 * SimulationController — deterministic end-to-end test trigger.
 *
 * POST /api/simulate-fire injects a mock detection report DIRECTLY into the
 * BullMQ queue, bypassing NASA FIRMS and the weather API entirely. The mock
 * is crafted to satisfy every branch of the phosphorus rule:
 *
 *   - coordinates (16.2155 E, 47.7593 N) — a point inside the seeded
 *     Föhrenwald outline, so the PostGIS ST_Intersects check WILL match,
 *   - temperature 32 °C  — above the 30 °C P4 auto-ignition threshold,
 *   - soil moisture 15 % — below the 20 % drought-cracking threshold.
 *
 * From the queue onward the event takes the exact same path as a real
 * satellite detection: DTO re-validation → PostGIS persistence + dedup →
 * ST_Intersects → CRITICAL_PHOSPHORUS_FIRE → Redis pub/sub → Socket.IO →
 * pulsing marker + dashboard entry in the Angular frontend. Only the
 * external data sources are mocked — the pipeline under test is real.
 *
 * Guarded by the operator API key: a public drill endpoint would let anyone
 * push fabricated CRITICAL alerts to every connected responder.
 */

import {
  Controller,
  HttpCode,
  Inject,
  OnModuleDestroy,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Queue } from 'bullmq';

import { API_KEY_HEADER, ApiKeyGuard } from '../auth/api-key.guard';
import { APP_CONFIG, AppConfig } from '../config/environment';
import { redisOptions } from '../redis/redis.factory';

/** Must match the workers' BUS.DETECTION_REPORTS_QUEUE (no ":" in BullMQ names). */
const DETECTION_REPORTS_QUEUE = 'events.detection-reports';

/**
 * A point guaranteed to lie inside the seeded Föhrenwald outline
 * (PostGIS ST_PointOnSurface of that polygon), WGS84 / SRID 4326.
 *
 * Must be kept in sync with FOEHRENWALD_POLYGON in RiskZoneService: if the
 * drill lands outside the zone it is evaluated as INFO, and the drill quietly
 * stops testing the alert path it exists to test.
 */
const FOEHRENWALD_CENTER = { longitude: 16.2155, latitude: 47.7593 };

@ApiTags('simulation')
@Controller('simulate-fire')
export class SimulationController implements OnModuleDestroy {
  /** Producer handle onto the same queue the enrichment worker feeds. */
  private readonly reportsQueue: Queue;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.reportsQueue = new Queue(DETECTION_REPORTS_QUEUE, {
      connection: redisOptions(config, 'stream'),
    });
  }

  @Post()
  @UseGuards(ApiKeyGuard) // injecting fake CRITICAL alerts must not be public
  @HttpCode(202) // Accepted: processing is asynchronous by design
  @ApiHeader({ name: API_KEY_HEADER, description: 'Operator API key', required: true })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid API key' })
  @ApiOperation({
    summary:
      'Inject a mock CRITICAL phosphorus-fire detection into the event pipeline',
  })
  async simulateFire(): Promise<{ status: string; injected: unknown }> {
    // Shaped exactly like the workers' DetectionReportDto — it must survive
    // the evaluation service's strict re-validation at the queue boundary.
    const mockReport = {
      detection: {
        source: 'MANUAL_SIMULATION',
        satellite: 'TEST',
        latitude: FOEHRENWALD_CENTER.latitude,
        longitude: FOEHRENWALD_CENTER.longitude,
        // Now = unique per call, so the dedup constraint never swallows a drill.
        acquiredAt: new Date().toISOString(),
        brightnessK: 340,
        frpMw: 12.5,
        confidence: 'h',
      },
      weather: {
        temperatureC: 32, // >= 30 °C → ignition temperature reached
        soilMoisturePct: 15, // < 20 % → drought-cracked soil, O2 exposure
        windSpeedKmh: 8,
        observedAt: new Date().toISOString(),
      },
    };

    // Auto-generated job id (no jobId option): every drill is a fresh event.
    await this.reportsQueue.add('detection-report', mockReport);

    return {
      status:
        'Mock detection queued — expect a CRITICAL_PHOSPHORUS_FIRE WebSocket alert within seconds.',
      injected: mockReport,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.reportsQueue.close();
  }
}
