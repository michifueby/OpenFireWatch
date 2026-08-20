/**
 * Backend-side mirror of the workers' DetectionReportDto.
 *
 * The queue is a TRUST BOUNDARY: even though the producer validates before
 * publishing, the consumer re-validates on arrival (defense in depth — a
 * rogue producer, a schema drift after a deploy, or a hand-crafted replay
 * from the DLQ must all be caught here, not in SQL).
 *
 * NOTE: In a larger monorepo this would live in a shared package
 * (e.g. /packages/shared-dto) imported by both services.
 */

import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class SatelliteDetectionDto {
  @IsString()
  @IsNotEmpty()
  source!: string;

  @IsOptional()
  @IsString()
  satellite?: string | null;

  /** WGS84 / SRID 4326 coordinates (GeoJSON order: longitude = x, latitude = y). */
  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  @IsISO8601()
  acquiredAt!: string;

  @IsOptional()
  @IsNumber()
  @Min(200)
  @Max(2000)
  brightnessK?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  frpMw?: number | null;

  @IsOptional()
  @IsString()
  confidence?: string | null;
}

export class WeatherObservationDto {
  @IsNumber()
  @Min(-90)
  @Max(60)
  temperatureC!: number;

  /** Topsoil volumetric water content, percent (0–100). */
  @IsNumber()
  @Min(0)
  @Max(100)
  soilMoisturePct!: number;

  /** Relative humidity in % (GeoSphere TAWES "RF") — context, not a rule input. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  relativeHumidityPct?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  windSpeedKmh?: number | null;

  @IsISO8601()
  observedAt!: string;
}

export class DetectionReportDto {
  @ValidateNested()
  @Type(() => SatelliteDetectionDto)
  detection!: SatelliteDetectionDto;

  @ValidateNested()
  @Type(() => WeatherObservationDto)
  weather!: WeatherObservationDto;
}
