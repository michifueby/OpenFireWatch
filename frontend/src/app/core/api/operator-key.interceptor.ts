/**
 * Attaches the operator credential to write requests, and takes it away the
 * moment the server says it is no good.
 *
 * This used to be five copies of the same eight lines — one per service that
 * could write — which meant five places to forget the header, and five places
 * to forget that a 401 has to clear the stored key. An interceptor is the one
 * place Angular offers for "every request that leaves this app", so the rule
 * is now stated once and cannot drift.
 *
 * Two deliberate restrictions:
 *
 *   - Same-origin `/api` requests only. The key is this deployment's
 *     credential and has no business travelling anywhere else, whatever URL a
 *     future caller passes.
 *   - Header, never a query parameter — a URL ends up in server logs and
 *     browser history; a header does not.
 */

import {
  HttpContextToken,
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';

import { OperatorKeyService } from './operator-key.service';

/**
 * A one-off key to use instead of the stored one.
 *
 * Exists for the unlock probe, which has to try a key that is not stored yet
 * — storing first and cleaning up afterwards would leave a bad key behind
 * whenever the probe itself failed to complete.
 */
export const OPERATOR_KEY_OVERRIDE = new HttpContextToken<string | null>(
  () => null,
);

/** Requests that carry the key. Reads are public and must stay unauthenticated. */
const GUARDED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function operatorKeyInterceptor(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  const keys = inject(OperatorKeyService);

  const override = request.context.get(OPERATOR_KEY_OVERRIDE);
  const key = override ?? keys.read();
  const applicable =
    request.url.startsWith('/api/') && GUARDED_METHODS.has(request.method);

  const outgoing =
    key && applicable
      ? request.clone({ setHeaders: { 'X-API-Key': key } })
      : request;

  return next(outgoing).pipe(
    catchError((error: unknown) => {
      // A rejected key is not worth keeping: every later write would fail the
      // same way, and the panel would keep offering actions that cannot work.
      if (
        applicable &&
        error instanceof HttpErrorResponse &&
        (error.status === 401 || error.status === 503)
      ) {
        keys.clear();
      }
      return throwError(() => error);
    }),
  );
}
