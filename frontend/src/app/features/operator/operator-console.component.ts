/**
 * OperatorConsoleComponent — the panel for managing hazard zones, the ground
 * sensors mounted in them, and the register of what actually happened.
 *
 * Design goals, in order:
 *   1. The common case is one gesture: draw the outline on the map, type two
 *      names, save. No coordinates typed by hand, no redeploy.
 *   2. Locked by default. Writes need the operator key, and the panel says so
 *      plainly instead of failing at save time.
 *   3. Destructive wording is honest: zones and sensors are *retired*, not
 *      deleted, because their alert history must survive.
 *
 * The panel starts collapsed so it never competes with the situation map,
 * which is what responders actually watch.
 *
 * This class is a shell. It holds what the sections genuinely share — the
 * lock, the three lists, and one `busy`/`error`/`notice` line — and shows one
 * section at a time. The forms and lists themselves are components in their
 * own feature folders, each of which owns its draft and hands back a finished
 * payload; before that split this file carried three drafts, three
 * confirmations and thirty setters at once.
 */

import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';

import { ApiError } from '@core/api/api-error';
import { TranslationService } from '@core/i18n/translation.service';
import {
  IncidentApiService,
  IncidentEntry,
  IncidentPayload,
  IncidentSummary,
} from '@features/incidents/data-access/incident-api.service';
import { IncidentFormComponent } from '@features/incidents/ui/incident-form.component';
import { IncidentListComponent } from '@features/incidents/ui/incident-list.component';
import {
  SensorApiService,
  SensorInfo,
  SensorPayload,
} from '@features/sensors/data-access/sensor-api.service';
import { SensorFormComponent } from '@features/sensors/ui/sensor-form.component';
import { ZoneApiService, ZoneListItem, ZonePayload } from '@features/zones/data-access/zone-api.service';
import { ZoneDrawService } from '@features/zones/data-access/zone-draw.service';
import { ZoneFormComponent } from '@features/zones/ui/zone-form.component';
import { ZoneListComponent } from '@features/zones/ui/zone-list.component';
import { IconComponent } from '@shared/ui/icon.component';

/** Which section the console is showing. Exactly one at a time, by design. */
type View =
  | { kind: 'list' }
  | { kind: 'zone'; zone: ZoneListItem | null }
  | { kind: 'sensor'; sensor: SensorInfo | null }
  | { kind: 'incident' };

@Component({
  selector: 'ofw-operator-console',
  standalone: true,
  imports: [
    IconComponent,
    ZoneListComponent,
    ZoneFormComponent,
    SensorFormComponent,
    IncidentListComponent,
    IncidentFormComponent,
  ],
  templateUrl: './operator-console.component.html',
  styleUrl: './operator-console.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OperatorConsoleComponent implements OnDestroy {
  readonly i18n = inject(TranslationService);
  readonly api = inject(ZoneApiService);
  private readonly sensorApi = inject(SensorApiService);
  private readonly incidentApi = inject(IncidentApiService);
  private readonly draw = inject(ZoneDrawService);

  readonly open = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  readonly zones = signal<readonly ZoneListItem[]>([]);
  readonly sensors = signal<readonly SensorInfo[]>([]);
  readonly incidents = signal<readonly IncidentEntry[]>([]);
  readonly incidentSummary = signal<IncidentSummary | null>(null);

  readonly view = signal<View>({ kind: 'list' });

  /** Narrowed for the template, which cannot do a discriminated union check. */
  readonly zoneUnderEdit = computed(() => {
    const view = this.view();
    return view.kind === 'zone' ? view.zone : null;
  });

  readonly sensorUnderEdit = computed(() => {
    const view = this.view();
    return view.kind === 'sensor' ? view.sensor : null;
  });

  private keyInput = '';

  // --- Panel -----------------------------------------------------------------

  async toggle(): Promise<void> {
    this.open.update((v) => !v);
    if (this.open()) await this.refresh();
  }

  async refresh(): Promise<void> {
    // One failing list must not blank the other two; each falls back alone.
    const [zones, sensors, incidents] = await Promise.all([
      this.api.list().catch(() => null),
      this.sensorApi.list().catch(() => null),
      this.incidentApi.list().catch(() => null),
    ]);

    if (zones) this.zones.set(zones);
    else this.error.set(this.i18n.t('zonesLoadFailed'));

    if (sensors) this.sensors.set(sensors);
    if (incidents) {
      this.incidents.set(incidents.incidents);
      this.incidentSummary.set(incidents.summary);
    }
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
    this.showList();
  }

  // --- Navigation ------------------------------------------------------------

  showList(): void {
    this.draw.cancel();
    this.view.set({ kind: 'list' });
    this.error.set(null);
  }

  private show(view: View): void {
    this.error.set(null);
    this.notice.set(null);
    this.view.set(view);
  }

  newZone(): void {
    this.show({ kind: 'zone', zone: null });
  }

  editZone(zone: ZoneListItem): void {
    this.show({ kind: 'zone', zone });
  }

  newSensor(): void {
    this.show({ kind: 'sensor', sensor: null });
  }

  editSensor(sensor: SensorInfo): void {
    this.show({ kind: 'sensor', sensor });
  }

  newIncident(): void {
    this.show({ kind: 'incident' });
  }

  // --- Writes ----------------------------------------------------------------

  saveZone(payload: ZonePayload): void {
    const editing = this.zoneUnderEdit();
    void this.perform(
      editing ? this.api.update(editing.id, payload) : this.api.create(payload),
      'zonesSaved',
    );
  }

  retireZone(zone: ZoneListItem): void {
    void this.perform(this.api.retire(zone.id));
  }

  saveSensor(payload: SensorPayload): void {
    const editing = this.sensorUnderEdit();
    void this.perform(
      editing
        ? this.sensorApi.update(editing.id, payload)
        : this.sensorApi.create(payload),
      'sensorSaved',
    );
  }

  retireSensor(sensor: SensorInfo): void {
    void this.perform(this.sensorApi.retire(sensor.id));
  }

  saveIncident(payload: IncidentPayload): void {
    void this.perform(this.incidentApi.create(payload), 'zonesSaved');
  }

  removeIncident(incident: IncidentEntry): void {
    void this.perform(this.incidentApi.remove(incident.id));
  }

  /**
   * Run one write and report it the same way every time: busy while it runs,
   * back to the list and a notice on success, the API's own complaint on
   * failure. Six call sites used to spell this out individually, and the
   * error handling had already drifted between three of them.
   */
  private async perform(
    operation: Promise<void>,
    successKey?: 'zonesSaved' | 'sensorSaved',
  ): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await operation;
      if (successKey) this.notice.set(this.i18n.t(successKey));
      this.draw.clearPoint();
      this.showList();
      await this.refresh();
    } catch (error) {
      // "locked" is the wire word; the panel has to say where the key goes.
      this.error.set(
        error instanceof ApiError && error.locked
          ? this.i18n.t('zonesUnlockHint')
          : (error as Error).message,
      );
    } finally {
      this.busy.set(false);
    }
  }

  ngOnDestroy(): void {
    this.draw.cancel();
  }
}
