/**
 * The form for one entry in the incident register: what happened, where, and
 * when.
 *
 * The register is what makes the thresholds testable — each recorded fire is
 * held against the ignition-window history and the alert record — so the two
 * fields that decide those verdicts, position and time, are the two the form
 * refuses to guess at.
 */

import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { TranslationService } from '@core/i18n/translation.service';
import { ZoneDrawService } from '@features/zones/data-access/zone-draw.service';

import { IncidentKind, IncidentPayload } from '../data-access/incident-api.service';

interface IncidentDraft {
  kind: IncidentKind;
  /** A `datetime-local` value — wall-clock, no zone. Converted on submit. */
  occurredAt: string;
  title: string;
  notes: string;
  latitude: number | null;
  longitude: number | null;
}

@Component({
  selector: 'ofw-incident-form',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  templateUrl: './incident-form.component.html',
  styleUrl: './incident-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IncidentFormComponent {
  readonly i18n = inject(TranslationService);
  readonly draw = inject(ZoneDrawService);

  readonly busy = input(false);
  readonly error = input<string | null>(null);

  readonly save = output<IncidentPayload>();
  /** Named `dismiss` rather than `cancel`: `cancel` is a native DOM event. */
  readonly dismiss = output<void>();

  readonly draft = signal<IncidentDraft>(emptyDraft());
  readonly localError = signal<string | null>(null);

  constructor() {
    this.draw.startPointPick();

    // The map click that places the incident — see ZoneFormComponent for why
    // this effect is allowed to write a signal.
    effect(
      () => {
        const point = this.draw.pickedPoint();
        if (!point) return;
        this.draft.update((d) => ({
          ...d,
          longitude: point[0],
          latitude: point[1],
        }));
      },
      { allowSignalWrites: true },
    );
  }

  reposition(): void {
    this.draw.startPointPick();
  }

  setKind(value: IncidentKind): void {
    this.draft.update((d) => ({ ...d, kind: value }));
  }

  setWhen(value: string): void {
    this.draft.update((d) => ({ ...d, occurredAt: value }));
  }

  setTitle(value: string): void {
    this.draft.update((d) => ({ ...d, title: value }));
  }

  setNotes(value: string): void {
    this.draft.update((d) => ({ ...d, notes: value }));
  }

  close(): void {
    this.draw.cancel();
    this.dismiss.emit();
  }

  submit(): void {
    const draft = this.draft();

    if (!draft.title.trim() || !draft.occurredAt) {
      this.localError.set(this.i18n.t('incidentNeedFields'));
      return;
    }
    if (draft.latitude === null || draft.longitude === null) {
      this.localError.set(this.i18n.t('sensorNeedPosition'));
      return;
    }

    this.localError.set(null);
    this.save.emit({
      // `datetime-local` carries no zone; Date interprets it as local time,
      // which is exactly what somebody typing a wall-clock time means.
      occurredAt: new Date(draft.occurredAt).toISOString(),
      latitude: draft.latitude,
      longitude: draft.longitude,
      kind: draft.kind,
      title: draft.title.trim(),
      notes: draft.notes.trim() || undefined,
    });
  }
}

/**
 * Preset to "now", in the local format `datetime-local` expects. Most entries
 * record something that just happened; historical ones edit the field.
 */
function emptyDraft(): IncidentDraft {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return {
    kind: 'fire',
    occurredAt: now.toISOString().slice(0, 16),
    title: '',
    notes: '',
    latitude: null,
    longitude: null,
  };
}
