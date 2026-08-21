/**
 * Recording a real-world event — validated before anything reaches SQL.
 */

import {
  IsIn,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * What kind of event this was. A closed list, because the validation logic
 * hangs off it: only a real fire can confirm or refute the thresholds, and a
 * free-text kind would quietly drop events from the analysis on a typo.
 *
 *   fire         something actually burned or ignited
 *   drill        an exercise — recorded so it never pollutes the statistics
 *   observation  something seen and checked, but no fire (smoke report, etc.)
 */
export const INCIDENT_KINDS = ['fire', 'drill', 'observation'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export class RegisterIncidentDto {
  /** When it happened — not when it was typed in. May be years in the past. */
  @IsISO8601()
  occurredAt!: string;

  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  @IsIn(INCIDENT_KINDS)
  kind!: IncidentKind;

  /** Short human label, e.g. "Waldbrand St. Egyden". */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  /** Free-form context: who reported it, what was found, references. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
