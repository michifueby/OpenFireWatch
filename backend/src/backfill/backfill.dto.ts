import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, Matches } from 'class-validator';

/** A closed date range, YYYY-MM-DD, both ends inclusive. */
export class StartBackfillDto {
  @ApiProperty({ example: '2019-01-01', description: 'First day, inclusive (UTC).' })
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be a plain date, YYYY-MM-DD' })
  from!: string;

  @ApiProperty({ example: '2019-12-31', description: 'Last day, inclusive (UTC).' })
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be a plain date, YYYY-MM-DD' })
  to!: string;
}
