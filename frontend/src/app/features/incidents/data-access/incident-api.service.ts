/**
 * IncidentApiService — the register of real events.
 *
 * Same repository shape as zones and sensors: public reads, guarded writes,
 * and a revision signal for anything that wants to react to changes.
 */

import { Injectable, inject, signal } from '@angular/core';

import { ApiClient } from '@core/api/api-client';

export type IncidentKind = 'fire' | 'drill' | 'observation';

export interface IncidentEntry {
  id: number;
  occurredAt: string;
  latitude: number;
  longitude: number;
  kind: IncidentKind;
  title: string;
  notes: string | null;
  zone: { id: number; name: { de: string; en: string } } | null;
  /** Null = the question does not apply; never conflate with false. */
  inIgnitionWindow: boolean | null;
  alertRaised: boolean;
}

export interface IncidentSummary {
  fires: number;
  firesInWindow: number;
  firesWindowApplicable: number;
  firesAlerted: number;
  alertsConfirmed: number;
  alertsNothingFound: number;
}

export interface IncidentPayload {
  occurredAt: string;
  latitude: number;
  longitude: number;
  kind: IncidentKind;
  title: string;
  notes?: string;
}

@Injectable({ providedIn: 'root' })
export class IncidentApiService {
  private readonly api = inject(ApiClient);

  readonly revision = signal(0);

  list(): Promise<{ incidents: IncidentEntry[]; summary: IncidentSummary }> {
    return this.api.get<{ incidents: IncidentEntry[]; summary: IncidentSummary }>(
      '/api/incidents',
    );
  }

  create(payload: IncidentPayload): Promise<void> {
    return this.write(this.api.post('/api/incidents', payload));
  }

  remove(id: number): Promise<void> {
    return this.write(this.api.delete(`/api/incidents/${id}`));
  }

  /** Success — and only success — advances the revision. */
  private async write(operation: Promise<unknown>): Promise<void> {
    await operation;
    this.revision.update((n) => n + 1);
  }
}
