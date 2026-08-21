/**
 * ZoneEditorComponent — operator panel for managing hazard zones and the
 * ground sensors mounted in them.
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
import { IconComponent } from '../shared/icon.component';
import { TranslationDict } from '../core/i18n/translations';
import {
  SensorApiService,
  SensorInfo,
} from '../sensors/sensor-api.service';
import {
  HazardType,
  ZoneApiService,
  ZoneListItem,
} from './zone-api.service';
import { ZoneDrawService } from './zone-draw.service';

/** What the sensor form edits. */
interface SensorDraft {
  id: number | null;
  deviceId: string;
  label: string;
  latitude: number | null;
  longitude: number | null;
  temperatureOffsetC: number;
  soilMoistureScale: number;
  soilMoistureOffsetPct: number;
}

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
  imports: [CommonModule, FormsModule, IconComponent],
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

  // --- Sensors ---------------------------------------------------------------

  readonly sensors = signal<SensorInfo[]>([]);
  /** Null = no sensor form open; otherwise the sensor being created/edited. */
  readonly sensorDraft = signal<SensorDraft | null>(null);
  readonly confirmingSensorRetire = signal<number | null>(null);
  /** Calibration inputs stay hidden until asked for — most sensors need none. */
  readonly showCalibration = signal(false);

  private keyInput = '';

  constructor(
    readonly i18n: TranslationService,
    readonly api: ZoneApiService,
    readonly sensorApi: SensorApiService,
    readonly draw: ZoneDrawService,
  ) {
    // Both effects adopt map gestures into form state, so both WRITE signals.
    // Angular forbids that by default (NG0600) and fails silently in prod —
    // which is exactly how the polygon hand-off below shipped broken. The
    // opt-in is deliberate here: draw → draft is a one-way street, so no
    // update cycle can form.

    // A double-click on the map completes the outline; adopt it into the draft.
    effect(
      () => {
        const completed = this.draw.completed();
        if (!completed) return;
        this.draft.update((d) => (d ? { ...d, geometry: completed } : d));
        this.draw.completed.set(null);
      },
      { allowSignalWrites: true },
    );

    // A point-pick click places the sensor; adopt it into the sensor draft.
    effect(
      () => {
        const point = this.draw.pickedPoint();
        if (!point) return;
        this.sensorDraft.update((d) =>
          d ? { ...d, longitude: point[0], latitude: point[1] } : d,
        );
      },
      { allowSignalWrites: true },
    );
  }

  // --- List ------------------------------------------------------------------

  async toggle(): Promise<void> {
    this.open.update((v) => !v);
    if (this.open()) await this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      // One failing list must not blank the other; each falls back alone.
      const [zones, sensors] = await Promise.all([
        this.api.list().catch(() => null),
        this.sensorApi.list().catch(() => null),
      ]);
      if (zones) this.zones.set(zones);
      else this.error.set('Could not load zones.');
      if (sensors) this.sensors.set(sensors);
    } catch {
      this.error.set('Could not load zones.');
    }
  }

  /** Sensors standing inside the given zone (derived server-side). */
  sensorsFor(zoneId: number): SensorInfo[] {
    return this.sensors().filter((sensor) => sensor.zoneId === zoneId);
  }

  /** Sensors outside every active zone — misplaced or awaiting their zone. */
  unassignedSensors(): SensorInfo[] {
    return this.sensors().filter((sensor) => sensor.zoneId === null);
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

  // --- Sensor draft ----------------------------------------------------------

  startNewSensor(): void {
    this.error.set(null);
    this.notice.set(null);
    this.showCalibration.set(false);
    this.sensorDraft.set({
      id: null,
      deviceId: '',
      label: '',
      latitude: null,
      longitude: null,
      temperatureOffsetC: 0,
      soilMoistureScale: 1,
      soilMoistureOffsetPct: 0,
    });
    this.draw.startPointPick();
  }

  startEditSensor(sensor: SensorInfo): void {
    this.error.set(null);
    this.notice.set(null);
    // Shown expanded when a calibration is already in effect: hiding an
    // active correction would misrepresent what the sensor reports.
    this.showCalibration.set(
      sensor.temperatureOffsetC !== 0 ||
        sensor.soilMoistureScale !== 1 ||
        sensor.soilMoistureOffsetPct !== 0,
    );
    this.sensorDraft.set({
      id: sensor.id,
      deviceId: sensor.deviceId,
      label: sensor.label,
      latitude: sensor.latitude,
      longitude: sensor.longitude,
      temperatureOffsetC: sensor.temperatureOffsetC,
      soilMoistureScale: sensor.soilMoistureScale,
      soilMoistureOffsetPct: sensor.soilMoistureOffsetPct,
    });
  }

  /** Move the sensor: the next map click replaces its position. */
  repositionSensor(): void {
    this.draw.startPointPick();
  }

  setSensorDeviceId(value: string): void {
    this.sensorDraft.update((d) => (d ? { ...d, deviceId: value } : d));
  }

  setSensorLabel(value: string): void {
    this.sensorDraft.update((d) => (d ? { ...d, label: value } : d));
  }

  setSensorTempOffset(value: number): void {
    this.sensorDraft.update((d) => (d ? { ...d, temperatureOffsetC: value } : d));
  }

  setSensorScale(value: number): void {
    this.sensorDraft.update((d) => (d ? { ...d, soilMoistureScale: value } : d));
  }

  setSensorSoilOffset(value: number): void {
    this.sensorDraft.update((d) =>
      d ? { ...d, soilMoistureOffsetPct: value } : d,
    );
  }

  cancelSensorDraft(): void {
    this.draw.cancel();
    this.sensorDraft.set(null);
    this.error.set(null);
  }

  async saveSensor(): Promise<void> {
    const draft = this.sensorDraft();
    if (!draft) return;

    if (!draft.deviceId.trim() || !draft.label.trim()) {
      this.error.set(this.i18n.t('sensorNeedFields'));
      return;
    }
    if (draft.latitude === null || draft.longitude === null) {
      this.error.set(this.i18n.t('sensorNeedPosition'));
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    try {
      const payload = {
        deviceId: draft.deviceId.trim(),
        label: draft.label.trim(),
        latitude: draft.latitude,
        longitude: draft.longitude,
        temperatureOffsetC: Number(draft.temperatureOffsetC) || 0,
        soilMoistureScale: Number(draft.soilMoistureScale) || 1,
        soilMoistureOffsetPct: Number(draft.soilMoistureOffsetPct) || 0,
      };
      if (draft.id === null) await this.sensorApi.create(payload);
      else await this.sensorApi.update(draft.id, payload);

      this.notice.set(this.i18n.t('sensorSaved'));
      this.sensorDraft.set(null);
      this.draw.clearPoint();
      await this.refresh();
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  askRetireSensor(sensor: SensorInfo): void {
    this.confirmingSensorRetire.set(sensor.id);
  }

  abortRetireSensor(): void {
    this.confirmingSensorRetire.set(null);
  }

  async retireSensor(sensor: SensorInfo): Promise<void> {
    this.confirmingSensorRetire.set(null);
    this.busy.set(true);
    try {
      await this.sensorApi.retire(sensor.id);
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
