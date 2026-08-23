/**
 * The list of hazard zones, each with the ground sensors standing inside it.
 *
 * Sensors are grouped under their zone because the zone is what a sensor
 * exists FOR — but the grouping itself is derived server-side from the
 * sensor's position via ST_Intersects, never assigned by hand. Sensors that
 * fall outside every active zone get their own group rather than being
 * hidden: that is usually a placement mistake, and hiding it would make the
 * mistake invisible.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { TranslationService } from '@core/i18n/translation.service';
import { TranslationDict } from '@core/i18n/translations';
import { SensorInfo } from '@features/sensors/data-access/sensor-api.service';
import { SensorRowComponent } from '@features/sensors/ui/sensor-row.component';

import { HazardType, ZoneListItem } from '../data-access/zone-api.service';

/** Hazard type → the translation key that names it for a reader. */
const HAZARD_LABELS: Readonly<Record<HazardType, keyof TranslationDict>> = {
  white_phosphorus: 'hazardWhitePhosphorus',
  white_phosphorus_forest: 'hazardWhitePhosphorusForest',
  wildfire: 'hazardWildfire',
  ammunition_depot: 'hazardAmmunitionDepot',
  generic: 'hazardGeneric',
};

@Component({
  selector: 'ofw-zone-list',
  standalone: true,
  imports: [SensorRowComponent],
  templateUrl: './zone-list.component.html',
  styleUrl: './zone-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZoneListComponent {
  readonly i18n = inject(TranslationService);

  readonly zones = input.required<readonly ZoneListItem[]>();
  readonly sensors = input.required<readonly SensorInfo[]>();
  readonly busy = input(false);

  readonly newZone = output<void>();
  readonly edit = output<ZoneListItem>();
  readonly retire = output<ZoneListItem>();
  readonly newSensor = output<void>();
  readonly editSensor = output<SensorInfo>();
  readonly retireSensor = output<SensorInfo>();

  /** Id of the zone awaiting retire confirmation, if any. */
  readonly confirming = signal<number | null>(null);

  /** Sensors outside every active zone — misplaced or awaiting their zone. */
  readonly unassigned = computed(() =>
    this.sensors().filter((sensor) => sensor.zoneId === null),
  );

  sensorsFor(zoneId: number): readonly SensorInfo[] {
    return this.sensors().filter((sensor) => sensor.zoneId === zoneId);
  }

  label(zone: ZoneListItem): string {
    return this.i18n.pick(zone.name);
  }

  hazardLabel(value: HazardType): string {
    return this.i18n.t(HAZARD_LABELS[value]);
  }

  askRetire(zone: ZoneListItem): void {
    this.confirming.set(zone.id);
  }

  confirmRetire(zone: ZoneListItem): void {
    this.confirming.set(null);
    this.retire.emit(zone);
  }
}
