/**
 * IncidentApiService — the register of real events.
 *
 * Same pattern as zones and sensors: public reads, operator-key writes via
 * the shared OperatorKeyService, and a revision signal for anything that
 * wants to react to changes.
 */

import { Injectable, inject, signal } from '@angular/core';

import { OperatorKeyService } from '../core/services/operator-key.service';

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
  private readonly operatorKey = inject(OperatorKeyService);

  readonly revision = signal(0);

  async list(): Promise<{ incidents: IncidentEntry[]; summary: IncidentSummary }> {
    const response = await fetch('/api/incidents');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as {
      incidents: IncidentEntry[];
      summary: IncidentSummary;
    };
  }

  create(payload: IncidentPayload): Promise<void> {
    return this.write('/api/incidents', 'POST', payload);
  }

  remove(id: number): Promise<void> {
    return this.write(`/api/incidents/${id}`, 'DELETE');
  }

  private async write(
    url: string,
    method: 'POST' | 'DELETE',
    payload?: IncidentPayload,
  ): Promise<void> {
    const key = this.operatorKey.read();
    if (!key) throw new Error('locked');

    const response = await fetch(url, {
      method,
      headers: {
        'X-API-Key': key,
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (response.ok) {
      this.revision.update((n) => n + 1);
      return;
    }
    if (response.status === 401) {
      this.operatorKey.clear();
      throw new Error('locked');
    }
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const detail = Array.isArray(body?.message)
      ? body!.message.join('; ')
      : (body?.message ?? `HTTP ${response.status}`);
    throw new Error(detail);
  }
}
