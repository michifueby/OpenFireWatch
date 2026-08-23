/**
 * StatusService — what every feed is actually doing.
 *
 * Polled while the panel is open and not otherwise: this answers a question
 * somebody is asking, not one worth asking every two minutes of every day.
 */

import { Injectable, inject, signal } from '@angular/core';

import { ApiClient } from '@core/api/api-client';

export type Freshness = 'ok' | 'stale' | 'missing';
export type Overall = 'ok' | 'degraded' | 'blind';

export interface FeedState {
  freshness: Freshness;
  at: string | null;
  ageSeconds: number | null;
}

export interface SourceStatus {
  source: string;
  ok: boolean;
  at: string | null;
  detections: number;
  error: string | null;
}

export interface SystemStatus {
  generatedAt: string;
  overall: Overall;
  ingestion: {
    cycle: FeedState;
    lookbackDays: number | null;
    sources: SourceStatus[];
  };
  weather: FeedState & {
    stationId: string | null;
    temperatureC: number | null;
    soilMoisturePct: number | null;
  };
  forecast: FeedState & { zones: number };
  fireDanger: FeedState & { zones: number };
  detections: {
    last24h: number;
    last7d: number;
    total: number;
    newestAcquiredAt: string | null;
    oldestAcquiredAt: string | null;
  };
  sensors: { registered: number; reporting: number; silent: number };
  queue: { deadLetters: number };
  archive: { runs: number; replayedTo: string | null; lastRunStatus: string | null };
}

@Injectable({ providedIn: 'root' })
export class StatusService {
  private readonly api = inject(ApiClient);

  readonly status = signal<SystemStatus | null>(null);

  async refresh(): Promise<void> {
    try {
      this.status.set(await this.api.get<SystemStatus>('/api/status'));
    } catch {
      // Keep the last picture rather than blanking a diagnostic page.
    }
  }
}
