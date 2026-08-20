/**
 * ZoneEditorComponent — operator panel for managing hazard zones.
 *
 * Design goals, in order:
 *   1. The common case is one gesture: draw the outline on the map, type two
 *      names, save. No coordinates typed by hand, no redeploy.
 *   2. Locked by default. Writes need the operator key, and the panel says so
 *      plainly instead of failing at save time.
 *   3. Destructive wording is honest: zones are *retired*, not deleted,
 *      because their alert history must survive.
 *
 * The panel starts collapsed so it never competes with the situation map,
 * which is what responders actually watch.
 */

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslationService } from '../core/i18n/translation.service';
import { TranslationDict } from '../core/i18n/translations';
import {
  HazardType,
  ZoneApiService,
  ZoneListItem,
} from './zone-api.service';
import { ZoneDrawService } from './zone-draw.service';

/** Hazard types offered in the form, with their translation keys. */
const HAZARD_OPTIONS: ReadonlyArray<{
  value: HazardType;
  key: keyof TranslationDict;
}> = [
  { value: 'white_phosphorus', key: 'hazardWhitePhosphorus' },
  { value: 'wildfire', key: 'hazardWildfire' },
  { value: 'ammunition_depot', key: 'hazardAmmunitionDepot' },
  { value: 'generic', key: 'hazardGeneric' },
];

@Component({
  selector: 'ofw-zone-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './zone-editor.component.html',
  styleUrls: ['./zone-editor.component.scss'],
})
export class ZoneEditorComponent implements OnDestroy {
  readonly hazardOptions = HAZARD_OPTIONS;

  readonly open = signal(false);
  readonly zones = signal<ZoneListItem[]>([]);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  /** Null = list view; otherwise the zone being created or edited. */
  readonly draft = signal<{
    id: number | null;
    nameEn: string;
    nameDe: string;
    hazardType: HazardType;
    geometry: GeoJSON.Polygon | null;
  } | null>(null);

  /** Id of the zone awaiting retire confirmation, if any. */
  readonly confirmingRetire = signal<number | null>(null);

  private keyInput = '';

  constructor(
    readonly i18n: TranslationService,
    readonly api: ZoneApiService,
    readonly draw: ZoneDrawService,
  ) {
    // A double-click on the map completes the outline; adopt it into the draft.
    effect(() => {
      const completed = this.draw.completed();
      if (!completed) return;
      this.draft.update((d) => (d ? { ...d, geometry: completed } : d));
      this.draw.completed.set(null);
    });
  }

  // --- List ------------------------------------------------------------------

  async toggle(): Promise<void> {
    this.open.update((v) => !v);
    if (this.open()) await this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      this.zones.set(await this.api.list());
    } catch {
      this.error.set('Could not load zones.');
    }
  }

  /** Zone label in the active language. */
  label(zone: ZoneListItem): string {
    return this.i18n.pick(zone.name);
  }

  hazardLabel(value: HazardType): string {
    const option = HAZARD_OPTIONS.find((o) => o.value === value);
    return option ? this.i18n.t(option.key) : value;
  }

  // --- Unlocking -------------------------------------------------------------

  onKeyInput(value: string): void {
    this.keyInput = value;
  }

  async unlock(): Promise<void> {
    this.error.set(null);
    if (!this.keyInput.trim()) return;
    this.busy.set(true);
    const ok = await this.api.unlock(this.keyInput.trim()).catch(() => false);
    this.busy.set(false);
    if (!ok) this.error.set(this.i18n.t('zonesInvalidKey'));
    else this.keyInput = '';
  }

  lock(): void {
    this.api.lock();
    this.cancelDraft();
  }

  // --- Draft -----------------------------------------------------------------

  startNew(): void {
    this.error.set(null);
    this.notice.set(null);
    this.draft.set({
      id: null,
      nameEn: '',
      nameDe: '',
      hazardType: 'white_phosphorus',
      geometry: null,
    });
    this.draw.start();
  }

  startEdit(zone: ZoneListItem): void {
    this.error.set(null);
    this.notice.set(null);
    this.draft.set({
      id: zone.id,
      nameEn: zone.name.en,
      nameDe: zone.name.de,
      hazardType: zone.hazardType,
      geometry: zone.geometry,
    });
  }

  /** Field setters — Angular templates cannot spread, and this keeps the
   *  immutable-signal-update pattern in one place. */
  setNameDe(value: string): void {
    this.draft.update((d) => (d ? { ...d, nameDe: value } : d));
  }

  setNameEn(value: string): void {
    this.draft.update((d) => (d ? { ...d, nameEn: value } : d));
  }

  setHazard(value: HazardType): void {
    this.draft.update((d) => (d ? { ...d, hazardType: value } : d));
  }

  /** Corner count of a captured outline (the closing point is not a corner). */
  cornerCount(geometry: GeoJSON.Polygon): number {
    return (geometry.coordinates[0]?.length ?? 1) - 1;
  }

  /** Re-draw the outline of the zone currently being edited. */
  redraw(): void {
    this.draft.update((d) => (d ? { ...d, geometry: null } : d));
    this.draw.start();
  }

  finishDrawing(): void {
    const polygon = this.draw.finish();
    if (!polygon) {
      this.error.set(this.i18n.t('zonesNeedGeometry'));
      return;
    }
    this.error.set(null);
    this.draft.update((d) => (d ? { ...d, geometry: polygon } : d));
  }

  cancelDrawing(): void {
    this.draw.cancel();
  }

  cancelDraft(): void {
    this.draw.cancel();
    this.draft.set(null);
    this.error.set(null);
  }

  async save(): Promise<void> {
    const draft = this.draft();
    if (!draft) return;

    if (!draft.nameEn.trim() || !draft.nameDe.trim()) {
      this.error.set(this.i18n.t('zonesNeedNames'));
      return;
    }
    if (!draft.geometry) {
      this.error.set(this.i18n.t('zonesNeedGeometry'));
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    try {
      const payload = {
        nameEn: draft.nameEn.trim(),
        nameDe: draft.nameDe.trim(),
        hazardType: draft.hazardType,
        geometry: draft.geometry,
      };
      if (draft.id === null) await this.api.create(payload);
      else await this.api.update(draft.id, payload);

      this.notice.set(this.i18n.t('zonesSaved'));
      this.draft.set(null);
      await this.refresh();
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Retiring is two-step and INLINE rather than a native confirm(): a browser
   * dialog cannot be styled, blocks the main thread, and is invisible to
   * automated tests. The second click happens in the panel itself.
   */
  askRetire(zone: ZoneListItem): void {
    this.confirmingRetire.set(zone.id);
  }

  abortRetire(): void {
    this.confirmingRetire.set(null);
  }

  async retire(zone: ZoneListItem): Promise<void> {
    this.confirmingRetire.set(null);
    this.busy.set(true);
    try {
      await this.api.retire(zone.id);
      await this.refresh();
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  ngOnDestroy(): void {
    this.draw.cancel();
  }
}
