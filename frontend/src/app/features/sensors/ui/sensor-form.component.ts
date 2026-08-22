/**
 * The form for one ground sensor: where it stands, what it is called, and —
 * folded away — how its raw readings are corrected.
 *
 * Calibration hides by default because most sensors need none, and three
 * numeric fields nobody understands would scare off exactly the people this
 * panel is meant to serve. It opens by itself when a correction is already in
 * effect: hiding an active calibration would misrepresent what the sensor
 * reports.
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
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { TranslationService } from '@core/i18n/translation.service';
import { ZoneDrawService } from '@features/zones/data-access/zone-draw.service';

import { SensorInfo, SensorPayload } from '../data-access/sensor-api.service';

interface SensorDraft {
  deviceId: string;
  label: string;
  latitude: number | null;
  longitude: number | null;
  temperatureOffsetC: number;
  soilMoistureScale: number;
  soilMoistureOffsetPct: number;
}

const EMPTY: SensorDraft = {
  deviceId: '',
  label: '',
  latitude: null,
  longitude: null,
  temperatureOffsetC: 0,
  soilMoistureScale: 1,
  soilMoistureOffsetPct: 0,
};

@Component({
  selector: 'ofw-sensor-form',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  templateUrl: './sensor-form.component.html',
  styleUrl: './sensor-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SensorFormComponent {
  readonly i18n = inject(TranslationService);
  readonly draw = inject(ZoneDrawService);

  readonly sensor = input<SensorInfo | null>(null);
  readonly busy = input(false);
  readonly error = input<string | null>(null);

  readonly save = output<SensorPayload>();
  /** Named `dismiss` rather than `cancel`: `cancel` is a native DOM event. */
  readonly dismiss = output<void>();

  readonly draft = signal<SensorDraft>(EMPTY);
  readonly showCalibration = signal(false);
  readonly localError = signal<string | null>(null);

  constructor() {
    effect(
      () => {
        const sensor = this.sensor();
        this.draft.set(
          sensor
            ? {
                deviceId: sensor.deviceId,
                label: sensor.label,
                latitude: sensor.latitude,
                longitude: sensor.longitude,
                temperatureOffsetC: sensor.temperatureOffsetC,
                soilMoistureScale: sensor.soilMoistureScale,
                soilMoistureOffsetPct: sensor.soilMoistureOffsetPct,
              }
            : EMPTY,
        );
        this.showCalibration.set(
          !!sensor &&
            (sensor.temperatureOffsetC !== 0 ||
              sensor.soilMoistureScale !== 1 ||
              sensor.soilMoistureOffsetPct !== 0),
        );
      // `untracked`: starting a gesture is a side effect, not a dependency.
      // The draw service repaints its draft layer as part of starting, and
      // repainting READS its own signals — so a bare call here subscribed
      // this effect to `pickedPoint`, and the very click that answered the
      // question re-ran the effect, which restarted the pick and threw the
      // answer away. The form sat waiting for a click it had already had.
      if (!sensor) untracked(() => this.draw.startPointPick());
      },
      { allowSignalWrites: true },
    );

    // The map click that places the sensor. Writes a signal from an effect
    // for the same reason as the zone outline — see ZoneFormComponent.
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

  /** Move the sensor: the next map click replaces its position. */
  reposition(): void {
    this.draw.startPointPick();
  }

  setLabel(value: string): void {
    this.draft.update((d) => ({ ...d, label: value }));
  }

  setDeviceId(value: string): void {
    this.draft.update((d) => ({ ...d, deviceId: value }));
  }

  setTempOffset(value: number): void {
    this.draft.update((d) => ({ ...d, temperatureOffsetC: value }));
  }

  setScale(value: number): void {
    this.draft.update((d) => ({ ...d, soilMoistureScale: value }));
  }

  setSoilOffset(value: number): void {
    this.draft.update((d) => ({ ...d, soilMoistureOffsetPct: value }));
  }

  close(): void {
    this.draw.cancel();
    this.dismiss.emit();
  }

  submit(): void {
    const draft = this.draft();

    if (!draft.deviceId.trim() || !draft.label.trim()) {
      this.localError.set(this.i18n.t('sensorNeedFields'));
      return;
    }
    if (draft.latitude === null || draft.longitude === null) {
      this.localError.set(this.i18n.t('sensorNeedPosition'));
      return;
    }

    this.localError.set(null);
    this.save.emit({
      deviceId: draft.deviceId.trim(),
      label: draft.label.trim(),
      latitude: draft.latitude,
      longitude: draft.longitude,
      // The numeric inputs hand back strings when a field is cleared; the
      // fallbacks are the "no correction" values, not zeroes across the board.
      temperatureOffsetC: Number(draft.temperatureOffsetC) || 0,
      soilMoistureScale: Number(draft.soilMoistureScale) || 1,
      soilMoistureOffsetPct: Number(draft.soilMoistureOffsetPct) || 0,
    });
  }
}
