/**
 * One ground sensor in the console's list: reporting state, name, its latest
 * readings, and the two actions it supports.
 *
 * The reporting dot carries the maintenance signal — green means fresh data,
 * grey means the probe has gone quiet — which is a thing worth seeing before
 * anybody trusts the numbers beside it.
 */

import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { TranslationService } from '@core/i18n/translation.service';
import { IconComponent } from '@shared/ui/icon.component';

import { SensorInfo } from '../data-access/sensor-api.service';

@Component({
  selector: 'ofw-sensor-row',
  standalone: true,
  imports: [DecimalPipe, IconComponent],
  templateUrl: './sensor-row.component.html',
  styleUrl: './sensor-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SensorRowComponent {
  readonly i18n = inject(TranslationService);

  readonly sensor = input.required<SensorInfo>();
  readonly busy = input(false);

  readonly edit = output<SensorInfo>();
  readonly retire = output<SensorInfo>();

  /**
   * Retiring is two-step and INLINE rather than a native confirm(): a browser
   * dialog cannot be styled, blocks the main thread, and is invisible to
   * automated tests. The second click happens in the row itself.
   */
  readonly confirming = signal(false);
}
