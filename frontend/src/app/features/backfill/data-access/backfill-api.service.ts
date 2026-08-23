/**
 * BackfillApiService — operator-triggered replays of the satellite archive.
 *
 * Same repository shape as zones, sensors and incidents: a public read of the
 * runs, a guarded write that starts one, and a `revision` signal for anyone
 * who wants to re-read when a run was started.
 */

import { Injectable, inject, signal } from '@angular/core';

import { ApiClient } from '@core/api/api-client';

export type BackfillStatus = 'queued' | 'running' | 'done' | 'failed';

export interface BackfillRun {
  id: number;
  status: BackfillStatus;
  from: string;
  to: string;
  sources: string | null;
  requestsTotal: number | null;
  requestsDone: number;
  detectionsFound: number;
  reportsQueued: number;
  /** Days inside the range no product covered — never "no fires". */
  coverageGaps: { from: string; to: string }[];
  /** What the rule made of the replayed passes, by alert level. */
  verdicts: Record<string, number>;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class BackfillApiService {
  private readonly api = inject(ApiClient);

  readonly revision = signal(0);

  list(): Promise<BackfillRun[]> {
    return this.api.get<BackfillRun[]>('/api/backfill/satellite');
  }

  async start(from: string, to: string): Promise<BackfillRun> {
    const run = await this.api.post<BackfillRun>('/api/backfill/satellite', { from, to });
    this.revision.update((n) => n + 1);
    return run;
  }
}
