/**
 * Query DTO for GET /api/anomalies — every parameter is validated by
 * class-validator BEFORE any code touches it (global ValidationPipe with
 * whitelist + forbidNonWhitelisted). Invalid input never reaches SQL.
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class QueryAnomaliesDto {
  @ApiPropertyOptional({ description: 'Viewport west bound (longitude)', example: 9.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  west?: number;

  @ApiPropertyOptional({ description: 'Viewport south bound (latitude)', example: 46.3 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  south?: number;

  @ApiPropertyOptional({ description: 'Viewport east bound (longitude)', example: 17.2 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  east?: number;

  @ApiPropertyOptional({ description: 'Viewport north bound (latitude)', example: 49.1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  north?: number;

  @ApiPropertyOptional({ description: 'Only anomalies acquired after this instant (ISO-8601)' })
  @IsOptional()
  @IsISO8601()
  since?: string;

  @ApiPropertyOptional({ description: 'Maximum number of features returned', default: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit: number = 500;
}
