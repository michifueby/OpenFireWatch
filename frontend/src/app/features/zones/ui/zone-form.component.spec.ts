import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ZoneDrawService } from '../data-access/zone-draw.service';
import { ZoneListItem, ZonePayload } from '../data-access/zone-api.service';
import { ZoneFormComponent } from './zone-form.component';

const POLYGON: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [16.1, 47.7],
      [16.2, 47.7],
      [16.2, 47.8],
      [16.1, 47.7],
    ],
  ],
};

describe('ZoneFormComponent', () => {
  let fixture: ComponentFixture<ZoneFormComponent>;
  let draw: ZoneDrawService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ZoneFormComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ZoneFormComponent);
    draw = TestBed.inject(ZoneDrawService);
    draw.attach(stubMap());
  });

  it('starts drawing straight away for a new zone', () => {
    fixture.componentRef.setInput('zone', null);
    fixture.detectChanges();
    expect(draw.drawing()).toBeTrue();
  });

  it('keeps the corners placed on the map instead of wiping them', () => {
    // Same trap as the sensor form's point pick: `draw.start()` clears the
    // corner list, so an effect that subscribed to that list would erase
    // every corner the moment one was placed. The panel's counter would sit
    // at 0 while the operator kept clicking.
    fixture.componentRef.setInput('zone', null);
    fixture.detectChanges();

    draw.corners.set([[16.1, 47.7]]);
    fixture.detectChanges();

    expect(draw.corners()).toEqual([[16.1, 47.7]]);
    expect(draw.drawing()).toBeTrue();
  });

  it('adopts an outline completed by a double-click on the map', () => {
    fixture.componentRef.setInput('zone', null);
    fixture.detectChanges();

    draw.completed.set(POLYGON);
    fixture.detectChanges();

    expect(fixture.componentInstance.draft().geometry).toEqual(POLYGON);
    // Consumed, so the next form does not inherit this outline.
    expect(draw.completed()).toBeNull();
  });

  it('adopts an existing zone without starting a new drawing', () => {
    fixture.componentRef.setInput('zone', zone());
    fixture.detectChanges();

    expect(draw.drawing()).toBeFalse();
    expect(fixture.componentInstance.draft().nameDe).toBe('Westteil');
    expect(fixture.componentInstance.draft().geometry).toEqual(POLYGON);
  });

  it('does not count the closing position as a corner', () => {
    // A GeoJSON ring repeats its first position at the end; a reader counting
    // corners on screen would otherwise always see one too many.
    expect(fixture.componentInstance.cornerCount(POLYGON)).toBe(3);
  });

  it('refuses to emit a zone that is missing one of its two names', () => {
    fixture.componentRef.setInput('zone', zone());
    fixture.detectChanges();
    fixture.componentInstance.setNameEn('   ');

    const emitted = jasmine.createSpy('save');
    fixture.componentInstance.save.subscribe(emitted);
    fixture.componentInstance.submit();

    expect(emitted).not.toHaveBeenCalled();
    expect(fixture.componentInstance.localError()).toBeTruthy();
  });

  it('refuses to emit a zone with no outline', () => {
    fixture.componentRef.setInput('zone', null);
    fixture.detectChanges();
    fixture.componentInstance.setNameDe('Neu');
    fixture.componentInstance.setNameEn('New');

    const emitted = jasmine.createSpy('save');
    fixture.componentInstance.save.subscribe(emitted);
    fixture.componentInstance.submit();

    expect(emitted).not.toHaveBeenCalled();
  });

  it('emits the trimmed payload once everything is there', () => {
    fixture.componentRef.setInput('zone', zone());
    fixture.detectChanges();
    fixture.componentInstance.setNameDe('  Westteil  ');
    fixture.componentInstance.setHazard('wildfire');

    let payload: ZonePayload | undefined;
    fixture.componentInstance.save.subscribe((p) => (payload = p));
    fixture.componentInstance.submit();

    expect(payload).toEqual({
      nameEn: 'western part',
      nameDe: 'Westteil',
      hazardType: 'wildfire',
      geometry: POLYGON,
    });
  });
});

function zone(): ZoneListItem {
  return {
    id: 1,
    name: { de: 'Westteil', en: 'western part' },
    hazardType: 'white_phosphorus',
    geometry: POLYGON,
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
