/**
 * Query DTO for GET /api/alerts — validated before anything reaches SQL.
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryAlertsDto {
  @ApiPropertyOptional({ description: 'Maximum entries returned', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 50;

  @ApiPropertyOptional({
    description: 'Look-back window in hours (max 30 days)',
    default: 72,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  sinceHours: number = 72;

  @ApiPropertyOptional({
    description: 'Return only CRITICAL_* levels, omitting INFO and ELEVATED',
    default: false,
  })
  @IsOptional()
  // Query strings arrive as text; accept the usual truthy spellings.
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  criticalOnly: boolean = false;

  @ApiPropertyOptional({
    description:
      'Return only alerts nobody has acknowledged yet — what is still outstanding',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  unacknowledgedOnly: boolean = false;
}
