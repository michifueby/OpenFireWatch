/**
 * ApiClient — the single door to the backend.
 *
 * Angular's HttpClient rather than bare `fetch`, for three things fetch does
 * not give you: interceptors (the operator key is attached in exactly one
 * place), a request pipeline that Angular's zone knows about, and a seam a
 * test can replace without patching a global.
 *
 * The surface is promise-based on purpose. Every caller here is a one-shot
 * command or query written in async/await; wrapping those in Observables
 * would add a layer that nothing in this application uses.
 */

import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';

import { toApiError } from './api-error';
import { OPERATOR_KEY_OVERRIDE } from './operator-key.interceptor';

export interface RequestOptions {
  /** Use this credential instead of the stored one — see the interceptor. */
  operatorKey?: string;
}

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);

  get<T>(path: string): Promise<T> {
    return this.run(this.http.get<T>(path));
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.run(
      this.http.post<T>(path, body ?? null, this.context(options)),
    );
  }

  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.run(
      this.http.put<T>(path, body ?? null, this.context(options)),
    );
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.run(this.http.delete<T>(path, this.context(options)));
  }

  /** One place where an HTTP failure becomes an ApiError. */
  private async run<T>(request: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request);
    } catch (cause) {
      throw toApiError(cause);
    }
  }

  private context(options?: RequestOptions): { context: HttpContext } {
    const context = new HttpContext();
    if (options?.operatorKey) {
      context.set(OPERATOR_KEY_OVERRIDE, options.operatorKey);
    }
    return { context };
  }
}
