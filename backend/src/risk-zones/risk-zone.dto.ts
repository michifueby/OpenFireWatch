/**
 * Write DTOs for hazard zones.
 *
 * Geometry arrives as GeoJSON from the browser and goes straight into
 * PostGIS, so it is validated strictly here — a malformed ring must be
 * rejected at the edge with a helpful message, never handed to SQL.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsString,
  MaxLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** Hazard categories the UI offers; extend together with the frontend. */
export const HAZARD_TYPES = [
  'white_phosphorus',
  'wildfire',
  'ammunition_depot',
  'generic',
] as const;
export type HazardType = (typeof HAZARD_TYPES)[number];

/**
 * Validates a GeoJSON Polygon: rings of [longitude, latitude] positions,
 * at least 4 positions per ring, first position equal to the last (closed),
 * and every coordinate within WGS84 bounds.
 */
@ValidatorConstraint({ name: 'GeoJsonPolygon', async: false })
export class IsGeoJsonPolygon implements ValidatorConstraintInterface {
  private reason = 'must be a valid GeoJSON Polygon';

  validate(value: unknown): boolean {
    const polygon = value as { type?: unknown; coordinates?: unknown };
    if (!polygon || polygon.type !== 'Polygon') {
      this.reason = 'geometry.type must be "Polygon"';
      return false;
    }
    if (!Array.isArray(polygon.coordinates) || polygon.coordinates.length === 0) {
      this.reason = 'geometry.coordinates must contain at least one ring';
      return false;
    }

    for (const ring of polygon.coordinates as unknown[]) {
      if (!Array.isArray(ring) || ring.length < 4) {
        this.reason = 'each ring needs at least 4 positions (3 corners + closing point)';
        return false;
      }
      for (const position of ring as unknown[]) {
        if (
          !Array.isArray(position) ||
          position.length < 2 ||
          typeof position[0] !== 'number' ||
          typeof position[1] !== 'number'
        ) {
          this.reason = 'each position must be a [longitude, latitude] number pair';
          return false;
        }
        const [lon, lat] = position as [number, number];
        if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
          this.reason = `position out of WGS84 bounds: [${lon}, ${lat}]`;
          return false;
        }
      }
      const first = (ring as number[][])[0]!;
      const last = (ring as number[][])[ring.length - 1]!;
      if (first[0] !== last[0] || first[1] !== last[1]) {
        this.reason = 'ring must be closed (first position equal to last)';
        return false;
      }
    }
    return true;
  }

  defaultMessage(): string {
    return this.reason;
  }
}

export class CreateRiskZoneDto {
  @ApiProperty({ example: 'Föhrenwald — former ordnance area' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nameEn!: string;

  @ApiProperty({ example: 'Föhrenwald — ehemaliges Munitionsgelände' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nameDe!: string;

  @ApiPropertyOptional({ enum: HAZARD_TYPES, default: 'white_phosphorus' })
  @IsIn(HAZARD_TYPES)
  hazardType: HazardType = 'white_phosphorus';

  @ApiProperty({
    description: 'GeoJSON Polygon in WGS84 (SRID 4326), coordinates as [lon, lat]',
    example: {
      type: 'Polygon',
      coordinates: [
        [
          [16.245, 47.795],
          [16.31, 47.795],
          [16.31, 47.755],
          [16.245, 47.755],
          [16.245, 47.795],
        ],
      ],
    },
  })
  @IsObject()
  @Validate(IsGeoJsonPolygon)
  geometry!: { type: 'Polygon'; coordinates: number[][][] };
}

/** Same shape — an edit always sends the complete zone. */
export class UpdateRiskZoneDto extends CreateRiskZoneDto {}
