/**
 * A value the server owns, kept fresh on a timer.
 *
 * Three services had grown the same twenty lines: a signal, a fetch, a
 * `setInterval` parked outside Angular's zone, and an `ngOnDestroy` to clear
 * it. The interesting difference between them was a URL and a number, so
 * that is all this asks for.
 *
 * Two details that are easy to get wrong, and are therefore made once here:
 *
 *   - The timer runs OUTSIDE Angular's zone. A poll that finds nothing new
 *     should not wake change detection; only landing data should, which is
 *     what the `zone.run` around the signal write is for.
 *   - A failed poll keeps the last known value instead of blanking the
 *     panel. Conditions that are two minutes stale are useful; a panel that
 *     empties itself because one request timed out is not.
 *
 * Must be called from an injection context (a field initialiser or a
 * constructor), which is also what ties the timer's lifetime to the caller's.
 */

import { DestroyRef, NgZone, Signal, inject, signal } from '@angular/core';

import { ApiClient } from './api-client';

export interface PolledResource<T> {
  /** Latest value, or null until the first response lands. */
  readonly value: Signal<T | null>;
  /** Fetch now, out of band with the timer. */
  refresh(): Promise<void>;
}

export function polledResource<T>(
  path: string,
  intervalMs: number,
): PolledResource<T> {
  const api = inject(ApiClient);
  const zone = inject(NgZone);
  const destroyRef = inject(DestroyRef);

  const value = signal<T | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      const fresh = await api.get<T>(path);
      zone.run(() => value.set(fresh));
    } catch {
      // Keep the last known value — see the note above.
    }
  };

  void refresh();

  const timer = zone.runOutsideAngular(() =>
    setInterval(() => void refresh(), intervalMs),
  );
  destroyRef.onDestroy(() => clearInterval(timer));

  return { value: value.asReadonly(), refresh };
}
