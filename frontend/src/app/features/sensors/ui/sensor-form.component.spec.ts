/**
 * Regression tests for the hand-off between a map gesture and a form.
 *
 * This is where the refactor to per-feature form components actually broke
 * something: starting the point-pick from inside an `effect` subscribed that
 * effect to the draw service's own signals — because starting a gesture
 * repaints the draft layer, and repainting reads them. The click that
 * answered the question then re-ran the effect, which restarted the pick and
 * discarded the answer. The form sat waiting for a click it had already had,
 * and nothing was logged.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ZoneDrawService } from '@features/zones/data-access/zone-draw.service';

import { SensorInfo } from '../data-access/sensor-api.service';
import { SensorFormComponent } from './sensor-form.component';

describe('SensorFormComponent', () => {
  let fixture: ComponentFixture<SensorFormComponent>;
  let draw: ZoneDrawService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SensorFormComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(SensorFormComponent);
    draw = TestBed.inject(ZoneDrawService);
    draw.attach(stubMap());
  });

  it('asks for a position as soon as it opens for a new sensor', () => {
    fixture.componentRef.setInput('sensor', null);
    fixture.detectChanges();
    expect(draw.drawing()).toBeTrue();
  });

  it('adopts the picked point and does not throw it away again', () => {
    fixture.componentRef.setInput('sensor', null);
    fixture.detectChanges();

    draw.pickedPoint.set([16.2155, 47.7593]);
    fixture.detectChanges();

    expect(fixture.componentInstance.draft().longitude).toBe(16.2155);
    expect(fixture.componentInstance.draft().latitude).toBe(47.7593);
    // The point must survive the round trip: a restarted pick would null it.
    expect(draw.pickedPoint()).toEqual([16.2155, 47.7593]);
  });

  it('adopts an existing sensor without asking for a new position', () => {
    fixture.componentRef.setInput('sensor', sensor());
    fixture.detectChanges();

    expect(draw.drawing()).toBeFalse();
    expect(fixture.componentInstance.draft().deviceId).toBe('eui-1');
    expect(fixture.componentInstance.draft().latitude).toBe(47.75);
  });

  it('opens the calibration fields when a correction is already in effect', () => {
    // Hiding an active calibration would misrepresent what the sensor reports.
    fixture.componentRef.setInput('sensor', sensor({ temperatureOffsetC: -1.5 }));
    fixture.detectChanges();
    expect(fixture.componentInstance.showCalibration()).toBeTrue();
  });

  it('keeps them folded away when the sensor reports raw', () => {
    fixture.componentRef.setInput('sensor', sensor());
    fixture.detectChanges();
    expect(fixture.componentInstance.showCalibration()).toBeFalse();
  });

  it('refuses to emit a sensor with no name, and says why', () => {
    fixture.componentRef.setInput('sensor', null);
    fixture.detectChanges();
    draw.pickedPoint.set([16, 47]);
    fixture.detectChanges();

    const emitted = jasmine.createSpy('save');
    fixture.componentInstance.save.subscribe(emitted);
    fixture.componentInstance.submit();

    expect(emitted).not.toHaveBeenCalled();
    expect(fixture.componentInstance.localError()).toBeTruthy();
  });

  it('refuses to emit a sensor with no position', () => {
    fixture.componentRef.setInput('sensor', null);
    fixture.detectChanges();
    fixture.componentInstance.setLabel('Probe 1');
    fixture.componentInstance.setDeviceId('eui-9');

    const emitted = jasmine.createSpy('save');
    fixture.componentInstance.save.subscribe(emitted);
    fixture.componentInstance.submit();

    expect(emitted).not.toHaveBeenCalled();
  });

  it('emits a trimmed payload with the no-correction calibration defaults', () => {
    fixture.componentRef.setInput('sensor', null);
    fixture.detectChanges();
    draw.pickedPoint.set([16.1, 47.7]);
    fixture.detectChanges();
    fixture.componentInstance.setLabel('  Probe 1  ');
    fixture.componentInstance.setDeviceId('  eui-9 ');
    // A cleared numeric field hands back an empty string.
    fixture.componentInstance.setScale('' as unknown as number);

    let payload: unknown;
    fixture.componentInstance.save.subscribe((p) => (payload = p));
    fixture.componentInstance.submit();

    expect(payload).toEqual({
      deviceId: 'eui-9',
      label: 'Probe 1',
      latitude: 47.7,
      longitude: 16.1,
      temperatureOffsetC: 0,
      // 1, not 0 — the identity for a scale, not for an offset.
      soilMoistureScale: 1,
      soilMoistureOffsetPct: 0,
    });
  });
});

function sensor(over: Partial<SensorInfo> = {}): SensorInfo {
  return {
    id: 1,
    deviceId: 'eui-1',
    label: 'Probe 1',
    latitude: 47.75,
    longitude: 16.2,
    zoneId: 1,
    lastSeenAt: null,
    reporting: true,
    temperatureC: null,
    soilMoisturePct: null,
    batteryPct: null,
    temperatureOffsetC: 0,
    soilMoistureScale: 1,
    soilMoistureOffsetPct: 0,
    ...over,
  };
}

/**
 * The smallest thing ZoneDrawService will accept as a map.
 *
 * Needed, not optional: without a map the service's `render()` returns before
 * it reads its own signals — and reading them is exactly the mechanism these
 * tests are here to pin down. A test with no map passes whether or not the
 * `untracked` guard is in place, which makes it worse than no test.
 */
function stubMap(): never {
  const source = { setData: (): void => undefined };
  return {
    addSource: (): void => undefined,
    addLayer: (): void => undefined,
    on: (): void => undefined,
    off: (): void => undefined,
    getSource: () => source,
    getCanvas: () => ({ style: {} }),
    doubleClickZoom: { enable: (): void => undefined, disable: (): void => undefined },
  } as never;
}
