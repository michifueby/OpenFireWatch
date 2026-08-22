/**
 * SensorIngestGuard — protects the reading intake.
 *
 * A separate credential from the operator key, on purpose. The gateway holds
 * this one and does nothing else with it; the operator key can redraw hazard
 * zones and clear alarms. A LoRaWAN gateway sits in a shed on somebody's
 * property, and whoever reaches it must not thereby be able to retire a zone.
 *
 * Device authenticity is not this guard's job: LoRaWAN already proves it
 * cryptographically at join time, and the intake additionally refuses any
 * device id that is not registered. This only proves the HTTP caller is the
 * gateway we expect.
 *
 * Fails closed, like ApiKeyGuard: an unset token refuses intake rather than
 * accepting readings from anyone who finds the URL.
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { matches } from '../auth/api-key.guard';
import { configSnapshot } from '../config/environment';

export const SENSOR_TOKEN_HEADER = 'x-sensor-token';

@Injectable()
export class SensorIngestGuard implements CanActivate {
  private readonly logger = new Logger(SensorIngestGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const configured = configSnapshot().auth.sensorIngestToken;
    if (!configured) {
      this.logger.error(
        'SENSOR_INGEST_TOKEN is not configured — refusing all sensor readings.',
      );
      throw new ServiceUnavailableException(
        'Sensor intake is not configured on this deployment. Set SENSOR_INGEST_TOKEN.',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    // Accepted on a dedicated header or as a bearer token, because LoRaWAN
    // network servers differ in which one they let you configure.
    const presented =
      request.header(SENSOR_TOKEN_HEADER)?.trim() ??
      request.header('authorization')?.replace(/^Bearer\s+/i, '').trim();

    if (!presented || !matches(presented, configured)) {
      throw new UnauthorizedException('Missing or invalid sensor token.');
    }
    return true;
  }
}
