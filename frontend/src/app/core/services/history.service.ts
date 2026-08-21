/**
 * HistoryService — the seasonal record of ignition windows.
 *
 * Fetched once when the panel first asks for it, not on a timer: a decade of
 * summers does not change while somebody is looking at it.
 */

import { Injectable, signal } from '@angular/core';

export interface MonthSummary {
  month: number;
  days: number;
  hours: number;
}

export interface YearSummary {
  year: number;
  days: number;
  hours: number;
  longestWindowHours: number;
  months: MonthSummary[];
}

export interface ZoneHistory {
  zoneId: number;
  name: { de: string; en: string };
  hazardType: string;
  weatherGated: boolean;
  /** Which soil layer the data came from — shown, not hidden. */
  sources: string[];
  years: YearSummary[];
  averageDaysPerYear: number | null;
}

@Injectable({ providedIn: 'root' })
export class HistoryService {
  readonly history = signal<{ zones: ZoneHistory[] } | null>(null);
  private loading = false;

  /** Idempotent: the panel calls this whenever it opens the section. */
  async load(): Promise<void> {
    if (this.loading || this.history()) return;
    this.loading = true;
    try {
      const response = await fetch('/api/history/ignition-windows');
      if (response.ok) {
        this.history.set(
          (await response.json()) as { zones: ZoneHistory[] },
        );
      }
    } catch {
      // The rest of the panel works without the record.
    } finally {
      this.loading = false;
    }
  }
}
