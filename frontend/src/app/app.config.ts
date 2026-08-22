/**
 * How the application is assembled.
 *
 * Previously `bootstrapApplication(AppComponent)` with no providers at all,
 * which meant every default was accepted by omission rather than by choice.
 * Each line below is a decision:
 */

import {
  ApplicationConfig,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { operatorKeyInterceptor } from '@core/api/operator-key.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    // Coalescing: a single tap on a phone fires several DOM events that
    // Angular would otherwise answer with a change-detection pass each. This
    // application repaints a WebGL map on those passes, so the difference is
    // measurable on the hardware a volunteer actually carries.
    provideZoneChangeDetection({ eventCoalescing: true }),

    // The operator key is attached by the interceptor, never by a caller.
    provideHttpClient(withInterceptors([operatorKeyInterceptor])),
  ],
};
