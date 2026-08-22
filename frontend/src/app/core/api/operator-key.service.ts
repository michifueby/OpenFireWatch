/**
 * OperatorKeyService — the one place that owns the operator credential.
 *
 * Extracted from ZoneApiService once acknowledging an alert also became a
 * guarded write: two services reading the same storage slot by hand would be
 * two places to get the storage-blocked case wrong, and two places to forget
 * to clear the key after a 401.
 *
 * Kept in `sessionStorage`, not `localStorage`, so it disappears when the tab
 * closes instead of persisting on a shared workstation. It is only ever sent
 * to the same origin as the app, in the `X-API-Key` header — never in a URL,
 * where it would end up in server logs and browser history.
 */

import { Injectable, signal } from '@angular/core';

const KEY_STORAGE = 'ofw-operator-key';

@Injectable({ providedIn: 'root' })
export class OperatorKeyService {
  /** Whether an operator key is present in this tab. */
  readonly unlocked = signal<boolean>(!!readStoredKey());

  read(): string | null {
    return readStoredKey();
  }

  store(key: string): void {
    try {
      sessionStorage.setItem(KEY_STORAGE, key);
    } catch {
      // Storage blocked (private mode): the key still works for this session,
      // it just will not survive a reload.
    }
    this.unlocked.set(true);
  }

  clear(): void {
    try {
      sessionStorage.removeItem(KEY_STORAGE);
    } catch {
      // Nothing was stored in the first place.
    }
    this.unlocked.set(false);
  }
}

function readStoredKey(): string | null {
  try {
    return sessionStorage.getItem(KEY_STORAGE);
  } catch {
    return null; // storage blocked (private mode) — writes stay locked
  }
}
