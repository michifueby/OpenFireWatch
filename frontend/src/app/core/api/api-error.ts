/**
 * One error type for everything the API can answer with.
 *
 * Before this existed, five services each unpacked a failed response by hand
 * — and each had its own idea of what a 401 meant. The rules are now stated
 * once:
 *
 *   401 / 503  the write is not possible with the credential this tab holds
 *              (rejected, or the server has writes disabled). Both leave the
 *              operator in the same position, so both surface as `locked`.
 *   anything    the API's own message, which names the actual problem
 *   else        ("ring must be closed", "already registered and active") in
 *              preference to a status code, which names nothing.
 */

import { HttpErrorResponse } from '@angular/common/http';

/** Message carried by a locked error — also the wire value tests assert on. */
export const LOCKED = 'locked';

export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or null when the request never reached the server. */
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** No usable operator credential — the caller should show the key prompt. */
  get locked(): boolean {
    return this.status === 401 || this.status === 503;
  }
}

/** Body shape NestJS uses for both validation errors and thrown exceptions. */
interface ApiErrorBody {
  message?: string | string[];
}

/** Normalise anything thrown by HttpClient into an ApiError. */
export function toApiError(cause: unknown): ApiError {
  if (!(cause instanceof HttpErrorResponse)) {
    return new ApiError(
      cause instanceof Error ? cause.message : String(cause),
      null,
    );
  }

  if (cause.status === 401 || cause.status === 503) {
    return new ApiError(LOCKED, cause.status);
  }

  // `error` is the parsed body for a JSON response, a string otherwise, and
  // a ProgressEvent when the request never completed.
  const body = (cause.error ?? null) as ApiErrorBody | string | null;
  const message =
    typeof body === 'string'
      ? body
      : Array.isArray(body?.message)
        ? body.message.join('; ')
        : (body?.message ?? null);

  return new ApiError(
    message ?? (cause.status ? `HTTP ${cause.status}` : cause.message),
    cause.status || null,
  );
}
