/**
 * Registering or editing a sensor from the UI.
 *
 * Calibration bounds are sanity limits, not physics: a scale of 8 or an
 * offset of 40 % is almost certainly a typo, and rejecting it here beats a
 * sensor that silently reports nonsense with three decimal places.
 */

import {
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RegisterSensorDto {
  /** Must match the LoRaWAN network server's device id exactly. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  deviceId!: string;

  /** Human name, e.g. "Föhrenwald Bodensonde 1 (Forststraße Ost)". */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;

  /** Where the probe is actually buried — the zone is derived from this. */
  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  @IsOptional()
  @IsNumber()
  @Min(-20)
  @Max(20)
  temperatureOffsetC?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(10)
  soilMoistureScale?: number;

  @IsOptional()
  @IsNumber()
  @Min(-50)
  @Max(50)
  soilMoistureOffsetPct?: number;
}
