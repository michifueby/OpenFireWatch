/**
 * The rules in api-error.ts decide what a responder reads when a write fails.
 * They are worth pinning down: before they existed, five services each had
 * their own idea of what a 401 meant.
 */

import { HttpErrorResponse } from '@angular/common/http';

import { ApiError, LOCKED, toApiError } from './api-error';

describe('toApiError', () => {
  const response = (status: number, body: unknown): HttpErrorResponse =>
    new HttpErrorResponse({ status, error: body, url: '/api/risk-zones' });

  it('reports 401 as locked', () => {
    const error = toApiError(response(401, { message: 'Unauthorized' }));
    expect(error.message).toBe(LOCKED);
    expect(error.locked).toBeTrue();
  });

  it('reports 503 as locked too — writes are disabled either way', () => {
    // The server answers 503 when no operator key is configured at all. The
    // operator is in the same position as with a rejected key, so the panel
    // must show the same thing rather than "HTTP 503".
    expect(toApiError(response(503, null)).locked).toBeTrue();
  });

  it("surfaces the API's own message rather than a status code", () => {
    const error = toApiError(response(400, { message: 'ring must be closed' }));
    expect(error.message).toBe('ring must be closed');
    expect(error.locked).toBeFalse();
  });

  it('joins the list of complaints a validation failure returns', () => {
    const error = toApiError(
      response(400, { message: ['latitude out of range', 'name is required'] }),
    );
    expect(error.message).toBe('latitude out of range; name is required');
  });

  it('falls back to the status when the body says nothing', () => {
    expect(toApiError(response(500, null)).message).toBe('HTTP 500');
  });

  it('accepts a plain-text error body', () => {
    expect(toApiError(response(404, 'Not Found')).message).toBe('Not Found');
  });

  it('survives something that is not an HTTP failure at all', () => {
    const error = toApiError(new TypeError('network down'));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('network down');
    expect(error.status).toBeNull();
    expect(error.locked).toBeFalse();
  });
});
