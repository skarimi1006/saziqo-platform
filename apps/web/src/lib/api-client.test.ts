// Tests verify Phase 12C acceptance criteria:
//   - successful GET parses the envelope
//   - 401 TOKEN_EXPIRED triggers refresh + retry of the original request
//   - concurrent 401s share a single refresh in-flight
//   - failed refresh clears the auth store and redirects to /login
//   - non-TOKEN_EXPIRED 401 is surfaced without triggering a refresh

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient, ApiError } from './api-client';

import { authStore } from '@/store/auth.store';


type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setLocationHref(): { get: () => string } {
  let href = 'http://localhost:3000/somewhere';
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      get href() {
        return href;
      },
      set href(next: string) {
        href = next;
      },
    },
  });
  return { get: () => href };
}

describe('ApiClient', () => {
  let fetchMock: FetchMock;
  let location: { get: () => string };

  beforeEach(() => {
    authStore.__resetForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    location = setLocationHref();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the parsed envelope on a successful GET', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { id: 1, name: 'ali' } }));
    const client = new ApiClient('http://api.test');
    authStore.setState({ accessToken: 'AT' });

    const result = await client.get<{ id: number; name: string }>('/users/me');

    expect(result.data).toEqual({ id: 1, name: 'ali' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/users/me');
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer AT');
    expect(headers.get('Accept-Language')).toBe('fa-IR');
    expect(headers.get('X-Request-Id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(init.credentials).toBe('include');
  });

  it('attaches Idempotency-Key when supplied', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { ok: true } }));
    const client = new ApiClient('http://api.test');

    await client.post('/wallet/topup', { amount: 1000 }, { idempotencyKey: 'key-123' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get('Idempotency-Key')).toBe('key-123');
    expect((init.headers as Headers).get('Content-Type')).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ amount: 1000 }));
  });

  it('skips Authorization when skipAuth is set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: null }));
    const client = new ApiClient('http://api.test');
    authStore.setState({ accessToken: 'AT' });

    await client.post('/auth/refresh', null, { skipAuth: true });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get('Authorization')).toBeNull();
  });

  it('refreshes and retries on 401 TOKEN_EXPIRED', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(401, {
          error: { code: 'TOKEN_EXPIRED', message: 'access token expired' },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { data: { accessToken: 'NEW_AT' } }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { id: 1 } }));
    const client = new ApiClient('http://api.test');
    authStore.setState({ accessToken: 'OLD_AT' });

    const result = await client.get<{ id: number }>('/users/me');

    expect(result.data).toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://api.test/api/v1/auth/refresh');
    const retryHeaders = (fetchMock.mock.calls[2]?.[1] as RequestInit).headers as Headers;
    expect(retryHeaders.get('Authorization')).toBe('Bearer NEW_AT');
    expect(authStore.getState().accessToken).toBe('NEW_AT');
  });

  it('surfaces non-TOKEN_EXPIRED 401 without refreshing', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 'SESSION_INVALID', message: 'gone' } }),
    );
    const client = new ApiClient('http://api.test');
    authStore.setState({ accessToken: 'AT' });

    await expect(client.get('/users/me')).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_INVALID',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares a single refresh across concurrent 401s', async () => {
    let refreshResolve: ((value: Response) => void) | undefined;
    const refreshPromise = new Promise<Response>((resolve) => {
      refreshResolve = resolve;
    });

    fetchMock.mockImplementation(((url: string) => {
      if (url.endsWith('/api/v1/auth/refresh')) {
        return refreshPromise;
      }
      // Bookkeeping: track call order via the URL suffix for retries.
      const suffix = url.split('/').pop();
      // First call from each request is a 401 TOKEN_EXPIRED; second is a 200.
      const calls = (fetchMock.mock.calls as [string, RequestInit][]).filter(([u]) =>
        u.endsWith(`/${suffix}`),
      );
      if (calls.length === 1) {
        return Promise.resolve(
          jsonResponse(401, {
            error: { code: 'TOKEN_EXPIRED', message: 'expired' },
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, { data: { resource: suffix } }));
    }) as never);

    const client = new ApiClient('http://api.test');
    authStore.setState({ accessToken: 'OLD_AT' });

    const inflight = Promise.all([client.get('/a'), client.get('/b'), client.get('/c')]);

    // Let the first round of 401s settle, then resolve the single refresh.
    await new Promise((r) => setTimeout(r, 0));
    refreshResolve?.(jsonResponse(200, { data: { accessToken: 'NEW_AT' } }));

    await inflight;

    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      (url as string).endsWith('/api/v1/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
    expect(authStore.getState().accessToken).toBe('NEW_AT');
  });

  it('on failed refresh, clears the auth store and redirects to /login', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(401, { error: { code: 'SESSION_INVALID', message: 'gone' } }),
      );
    const client = new ApiClient('http://api.test');
    authStore.setState({ accessToken: 'OLD_AT' });

    await expect(client.get('/users/me')).rejects.toBeInstanceOf(ApiError);

    expect(authStore.getState().accessToken).toBeNull();
    expect(location.get()).toBe('/login');
    // Two calls: original 401, then refresh 401. No retry of the original.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws ApiError with normalized fields on 4xx errors', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'phone required',
          details: { field: 'phone' },
          requestId: 'req-1',
        },
      }),
    );
    const client = new ApiClient('http://api.test');

    await expect(client.post('/auth/login', {})).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'phone required',
      details: { field: 'phone' },
      requestId: 'req-1',
    });
  });
});
