/**
 * The interceptor is the single place the operator credential is attached and
 * dropped. It replaced five hand-written copies of these rules, so the rules
 * are asserted here rather than trusted.
 */

import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ApiClient } from './api-client';
import { LOCKED } from './api-error';
import { OPERATOR_KEY_OVERRIDE, operatorKeyInterceptor } from './operator-key.interceptor';
import { OperatorKeyService } from './operator-key.service';

describe('operatorKeyInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let keys: OperatorKeyService;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([operatorKeyInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    keys = TestBed.inject(OperatorKeyService);
  });

  afterEach(() => {
    httpMock.verify();
    sessionStorage.clear();
  });

  it('attaches the stored key to a write', () => {
    keys.store('secret');
    http.post('/api/risk-zones', {}).subscribe();
    expect(httpMock.expectOne('/api/risk-zones').request.headers.get('X-API-Key')).toBe(
      'secret',
    );
  });

  it('leaves reads unauthenticated — the map is public', () => {
    keys.store('secret');
    http.get('/api/risk-zones').subscribe();
    expect(
      httpMock.expectOne('/api/risk-zones').request.headers.has('X-API-Key'),
    ).toBeFalse();
  });

  it('never sends the key off this origin', () => {
    keys.store('secret');
    http.post('https://example.com/collect', {}).subscribe();
    expect(
      httpMock.expectOne('https://example.com/collect').request.headers.has('X-API-Key'),
    ).toBeFalse();
  });

  it('drops a rejected key so later writes stop pretending they can work', () => {
    keys.store('stale');
    http.post('/api/risk-zones', {}).subscribe({ error: () => undefined });
    httpMock
      .expectOne('/api/risk-zones')
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    expect(keys.read()).toBeNull();
    expect(keys.unlocked()).toBeFalse();
  });

  it('drops the key when the server has writes disabled entirely (503)', () => {
    keys.store('valid-but-useless');
    http.delete('/api/sensors/1').subscribe({ error: () => undefined });
    httpMock
      .expectOne('/api/sensors/1')
      .flush(null, { status: 503, statusText: 'Service Unavailable' });
    expect(keys.read()).toBeNull();
  });

  it('keeps the key when the request failed for some other reason', () => {
    keys.store('fine');
    http.post('/api/risk-zones', {}).subscribe({ error: () => undefined });
    httpMock
      .expectOne('/api/risk-zones')
      .flush({ message: 'ring must be closed' }, { status: 400, statusText: 'Bad Request' });
    expect(keys.read()).toBe('fine');
  });
});

describe('ApiClient', () => {
  let api: ApiClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([operatorKeyInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    api = TestBed.inject(ApiClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => sessionStorage.clear());

  it('sends a one-off key instead of the stored one', async () => {
    TestBed.inject(OperatorKeyService).store('stored');
    const pending = api.post('/api/risk-zones', {}, { operatorKey: 'probe' });
    const request = httpMock.expectOne('/api/risk-zones');
    expect(request.request.headers.get('X-API-Key')).toBe('probe');
    expect(request.request.context.get(OPERATOR_KEY_OVERRIDE)).toBe('probe');
    request.flush({});
    await pending;
  });

  it('rejects with an ApiError carrying the API\'s own message', async () => {
    const pending = api.put('/api/risk-zones/1', {});
    httpMock
      .expectOne('/api/risk-zones/1')
      .flush({ message: 'ring must be closed' }, { status: 400, statusText: 'Bad Request' });
    await expectAsync(pending).toBeRejectedWithError('ring must be closed');
  });

  it('rejects a guarded write with "locked" when the key is refused', async () => {
    const pending = api.delete('/api/incidents/7');
    httpMock
      .expectOne('/api/incidents/7')
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    await expectAsync(pending).toBeRejectedWithError(LOCKED);
  });
});
