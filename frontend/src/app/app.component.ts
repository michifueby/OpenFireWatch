import { Component } from '@angular/core';

import { AboutPanelComponent } from './about/about-panel.component';
import { AlertDashboardComponent } from './alerts/alert-dashboard.component';
import { MapComponent } from './map/map.component';
import { ZoneEditorComponent } from './zones/zone-editor.component';

/** Application shell: full-screen map with the overlay panels on top. */
@Component({
  selector: 'ofw-root',
  standalone: true,
  imports: [
    MapComponent,
    AlertDashboardComponent,
    AboutPanelComponent,
    ZoneEditorComponent,
  ],
  template: `
    <ofw-map />
    <ofw-alert-dashboard />
    <ofw-zone-editor />
    <ofw-about-panel />
  `,
})
export class AppComponent {}
