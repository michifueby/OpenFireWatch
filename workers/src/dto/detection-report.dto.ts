/**
 * Strict Data Transfer Objects for everything that crosses the event bus.
 *
 * Every payload is validated with class-validator BEFORE it is published to
 * Redis — a malformed satellite row or a broken weather response can never
 * poison downstream consumers. The NestJS side re-validates on consumption
 * (defense in depth): the queue is a trust boundary, not a type guarantee.
 *
 * NOTE: In a larger monorepo these DTOs would live in a shared package
 * (e.g. /packages/shared-dto) imported by both workers and backend; they are
 * duplicated for now to keep each service independently buildable.
 */

import { Type } from 'class-transformer';
import {
  IsIn,
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

/** A single thermal hotspot as reported by a satellite source (NASA FIRMS). */
export class SatelliteDetectionDto {
  /** Data source identifier, e.g. "VIIRS_SNPP_NRT". */
  @IsString()
  @IsNotEmpty()
  source!: string;

  /** Satellite short code (e.g. "N" for Suomi NPP); optional in FIRMS CSV. */
  @IsOptional()
  @IsString()
  satellite?: string | null;

  /**
   * Detection coordinates in WGS84 (SRID 4326) — the coordinate reference
   * system used by GPS, GeoJSON and FIRMS alike. Longitude is the X axis,
   * latitude the Y axis; PostGIS ST_MakePoint therefore takes (lon, lat).
   */
  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  /** Acquisition timestamp (UTC, ISO-8601) of the satellite pass. */
  @IsISO8601()
  acquiredAt!: string;

  /** Brightness temperature in Kelvin (VIIRS I-4 band ≈ 3.55–3.93 µm). */
  @IsOptional()
  @IsNumber()
  @Min(200)
  @Max(2000)
  brightnessK?: number | null;

  /** Fire Radiative Power in megawatts — proxy for fire intensity. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  frpMw?: number | null;

  /** FIRMS confidence: 'l' | 'n' | 'h' (VIIRS) or 0–100 (MODIS). */
  @IsOptional()
  @IsString()
  confidence?: string | null;
}

/** Ground weather conditions at (and around) the detection coordinate. */
export class WeatherObservationDto {
  /** 2m air temperature in °C. Physical bounds guard against unit mix-ups
   *  (a Kelvin value smuggled in here would fail validation loudly). */
  @IsNumber()
  @Min(-90)
  @Max(60)
  temperatureC!: number;

  /**
   * Topsoil moisture as a PERCENTAGE (0–100) of volumetric water content.
   * This is the key phosphorus indicator: below ~20% the topsoil dries out
   * and cracks, exposing buried white phosphorus ordnance to atmospheric
   * oxygen — the precondition for self-ignition.
   */
  @IsNumber()
  @Min(0)
  @Max(100)
  soilMoisturePct!: number;

  /**
   * Relative humidity in % (GeoSphere TAWES "RF"). Not part of the ignition
   * rule itself, but a leading indicator of desiccation and valuable context
   * for responders.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  relativeHumidityPct?: number | null;

  /** Wind speed in km/h — not part of the ignition rule, but critical for
   *  responders estimating spread once a fire is confirmed. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  windSpeedKmh?: number | null;

  /** When the observation was taken (UTC, ISO-8601). */
  @IsISO8601()
  observedAt!: string;
}

/**
 * The composite event consumed by the evaluation layer: one satellite
 * detection enriched with the weather at its exact coordinate.
 */
export class DetectionReportDto {
  @ValidateNested()
  @Type(() => SatelliteDetectionDto)
  detection!: SatelliteDetectionDto;

  @ValidateNested()
  @Type(() => WeatherObservationDto)
  weather!: WeatherObservationDto;

  /**
   * How this report entered the system. `backfill` marks a detection replayed
   * from the satellite archive: it is evaluated by the same rule and stored
   * like any other, but it is HISTORY — nothing may alarm, page or pulse on
   * it, and today's ground sensors say nothing about the day it happened.
   * Absent means live.
   */
  @IsOptional()
  @IsIn(['live', 'backfill'])
  ingestion?: 'live' | 'backfill';
}
