/**
 * What a ground sensor reports, and how a LoRaWAN uplink is turned into it.
 *
 * Field names are strict on purpose. A payload formatter could plausibly emit
 * `temp`, `t`, or a raw ADC count, and guessing which would mean guessing the
 * unit too — a soil-moisture sensor that actually reports 0–1023 would sail
 * straight past a "below 20 %" threshold and read as bone dry forever. The
 * formatter is one small function in the network server's own UI; making it
 * emit these names is the operator's job, and a rejected payload says so.
 */

import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class SensorReadingDto {
  /** Device id as registered — for LoRaWAN, the network server's device id. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  deviceId!: string;

  @IsISO8601()
  observedAt!: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(150) // above ambient records: a sensor in a fire is the point of it
  temperatureC?: number | null;

  /** Topsoil volumetric water content, percent — the calibrated value. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  soilMoisturePct?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  relativeHumidityPct?: number | null;

  /**
   * Remaining charge. Not a measurement of the world, but the difference
   * between "conditions are fine" and "this thing stopped telling us".
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  batteryPct?: number | null;
}

/** A batch, so a gateway can forward several uplinks in one request. */
export class SensorReadingBatchDto {
  @ValidateNested({ each: true })
  @Type(() => SensorReadingDto)
  readings!: SensorReadingDto[];
}

/**
 * The subset of a LoRaWAN (TTN v3 style) uplink this intake understands.
 * Everything else in the envelope — gateway metadata, frame counters, signal
 * strength — is deliberately ignored rather than stored: it would be a second
 * schema to maintain for data no rule reads.
 */
interface LoraUplink {
  end_device_ids?: { device_id?: string };
  received_at?: string;
  uplink_message?: {
    decoded_payload?: Record<string, unknown>;
    received_at?: string;
  };
}

/**
 * Accept either shape on the same endpoint: our own `{ readings: [...] }`, or
 * a network-server uplink posted straight from a webhook. The second exists
 * so that connecting a gateway is a form to fill in rather than a relay
 * service somebody has to write, host and keep running.
 *
 * Returns null when the body is neither, so the caller can answer with a
 * message naming both accepted shapes instead of a validation dump.
 */
export function normaliseIntakeBody(body: unknown): SensorReadingDto[] | null {
  if (!body || typeof body !== 'object') return null;

  const batch = body as Partial<SensorReadingBatchDto>;
  if (Array.isArray(batch.readings)) return batch.readings as SensorReadingDto[];

  // A single canonical reading, unwrapped.
  const single = body as Partial<SensorReadingDto>;
  if (typeof single.deviceId === 'string') return [single as SensorReadingDto];

  const uplink = body as LoraUplink;
  const deviceId = uplink.end_device_ids?.device_id;
  const payload = uplink.uplink_message?.decoded_payload;
  if (!deviceId || !payload) return null;

  return [
    {
      deviceId,
      // The network server's own timestamp: a device with a drifting clock
      // must not be able to backdate a reading out of the freshness window.
      observedAt:
        uplink.uplink_message?.received_at ??
        uplink.received_at ??
        new Date().toISOString(),
      temperatureC: numeric(payload['temperatureC']),
      soilMoisturePct: numeric(payload['soilMoisturePct']),
      relativeHumidityPct: numeric(payload['relativeHumidityPct']),
      batteryPct: numeric(payload['batteryPct']),
    },
  ];
}

/** Absent stays absent; anything non-numeric fails validation downstream. */
function numeric(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === 'number' ? value : (value as number);
}
