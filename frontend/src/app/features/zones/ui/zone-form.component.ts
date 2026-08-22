/**
 * The form for one hazard zone — the outline, the two names, the hazard type.
 *
 * Self-contained: it owns the draft, it drives the drawing service, and it
 * hands back a finished payload. The console that hosts it never sees a
 * half-typed name. That is the whole point of the split — the console used to
 * hold the draft state for zones, sensors AND incidents at once, and telling
 * which `cancel...` belonged to which form was a matter of reading carefully.
 */

import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslationService } from '@core/i18n/translation.service';
import { TranslationDict } from '@core/i18n/translations';

import { HazardType, ZoneListItem, ZonePayload } from '../data-access/zone-api.service';
import { ZoneDrawService } from '../data-access/zone-draw.service';

/** Hazard types offered in the form, with their translation keys. */
const HAZARD_OPTIONS: readonly {
  value: HazardType;
  key: keyof TranslationDict;
}[] = [
  { value: 'white_phosphorus', key: 'hazardWhitePhosphorus' },
  { value: 'wildfire', key: 'hazardWildfire' },
  { value: 'ammunition_depot', key: 'hazardAmmunitionDepot' },
  { value: 'generic', key: 'hazardGeneric' },
];

interface ZoneDraft {
  nameEn: string;
  nameDe: string;
  hazardType: HazardType;
  geometry: GeoJSON.Polygon | null;
}

@Component({
  selector: 'ofw-zone-form',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './zone-form.component.html',
  styleUrl: './zone-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZoneFormComponent {
  readonly i18n = inject(TranslationService);
  readonly draw = inject(ZoneDrawService);

  /** The zone being edited, or null to draw a new one. */
  readonly zone = input<ZoneListItem | null>(null);
  readonly busy = input(false);
  /** Whatever the last save attempt was rejected for. */
  readonly error = input<string | null>(null);

  readonly save = output<ZonePayload>();
  /** Named `dismiss` rather than `cancel`: `cancel` is a native DOM event. */
  readonly dismiss = output<void>();

  readonly hazardOptions = HAZARD_OPTIONS;

  readonly draft = signal<ZoneDraft>({
    nameEn: '',
    nameDe: '',
    hazardType: 'white_phosphorus',
    geometry: null,
  });

  /** Locally raised complaints (empty names, no outline) — not the API's. */
  readonly localError = signal<string | null>(null);

  constructor() {
    // Adopt the zone this form was opened for, and start drawing when there
    // is nothing to adopt.
    effect(
      () => {
        const zone = this.zone();
        this.draft.set(
          zone
            ? {
                nameEn: zone.name.en,
                nameDe: zone.name.de,
                hazardType: zone.hazardType,
                geometry: zone.geometry,
              }
            : {
                nameEn: '',
                nameDe: '',
                hazardType: 'white_phosphorus',
                geometry: null,
              },
        );
      // `untracked`: starting a gesture is a side effect, not a dependency.
      // The draw service repaints its draft layer as part of starting, and
      // repainting READS its own signals — so a bare call here subscribed
      // this effect to `pickedPoint`, and the very click that answered the
      // question re-ran the effect, which restarted the pick and threw the
      // answer away. The form sat waiting for a click it had already had.
      if (!zone) untracked(() => this.draw.start());
      },
      { allowSignalWrites: true },
    );

    // A double-click on the map completes the outline; adopt it into the
    // draft. Angular forbids signal writes in effects by default (NG0600) and
    // fails SILENTLY in a production build — which is exactly how this
    // hand-off once shipped broken. The opt-in is deliberate: draw → draft is
    // a one-way street, so no update cycle can form.
    effect(
      () => {
        const completed = this.draw.completed();
        if (!completed) return;
        this.draft.update((d) => ({ ...d, geometry: completed }));
        this.draw.completed.set(null);
      },
      { allowSignalWrites: true },
    );
  }

  setNameDe(value: string): void {
    this.draft.update((d) => ({ ...d, nameDe: value }));
  }

  setNameEn(value: string): void {
    this.draft.update((d) => ({ ...d, nameEn: value }));
  }

  setHazard(value: HazardType): void {
    this.draft.update((d) => ({ ...d, hazardType: value }));
  }

  /** Corner count of a captured outline (the closing point is not a corner). */
  cornerCount(geometry: GeoJSON.Polygon): number {
    return (geometry.coordinates[0]?.length ?? 1) - 1;
  }

  /** Re-draw the outline of the zone currently being edited. */
  redraw(): void {
    this.draft.update((d) => ({ ...d, geometry: null }));
    this.draw.start();
  }

  finishDrawing(): void {
    const polygon = this.draw.finish();
    if (!polygon) {
      this.localError.set(this.i18n.t('zonesNeedGeometry'));
      return;
    }
    this.localError.set(null);
    this.draft.update((d) => ({ ...d, geometry: polygon }));
  }

  cancelDrawing(): void {
    this.draw.cancel();
  }

  close(): void {
    this.draw.cancel();
    this.dismiss.emit();
  }

  submit(): void {
    const draft = this.draft();

    if (!draft.nameEn.trim() || !draft.nameDe.trim()) {
      this.localError.set(this.i18n.t('zonesNeedNames'));
      return;
    }
    if (!draft.geometry) {
      this.localError.set(this.i18n.t('zonesNeedGeometry'));
      return;
    }

    this.localError.set(null);
    this.save.emit({
      nameEn: draft.nameEn.trim(),
      nameDe: draft.nameDe.trim(),
      hazardType: draft.hazardType,
      geometry: draft.geometry,
    });
  }
}
