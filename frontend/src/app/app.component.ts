import { ChangeDetectionStrategy, Component } from '@angular/core';

import { AboutPanelComponent } from '@features/about/about-panel.component';
import { AlertDashboardComponent } from '@features/alerts/alert-dashboard.component';
import { MapComponent } from '@features/map/map.component';
import { OperatorConsoleComponent } from '@features/operator/operator-console.component';

/** Application shell: full-screen map with the overlay panels on top. */
@Component({
  selector: 'ofw-root',
  standalone: true,
  imports: [
    MapComponent,
    AlertDashboardComponent,
    AboutPanelComponent,
    OperatorConsoleComponent,
  ],
  template: `
    <ofw-map />
    <ofw-alert-dashboard />
    <ofw-operator-console />
    <ofw-about-panel />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {}
