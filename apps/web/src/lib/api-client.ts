// CLAUDE: Single point of contact between the web app and the NestJS API.
// Owns: bearer-token attachment, X-Request-Id, Idempotency-Key, error
// normalization, and silent access-token refresh on 401 TOKEN_EXPIRED.
//
// SECURITY: Refresh tokens live in an httpOnly cookie set by the API at
// login. We never read or write that cookie from JS — `credentials:
// 'include'` lets the browser ship it on /auth/refresh. The short-lived
// access token is held in memory only (authStore); reload triggers
// bootstrap() in Phase 12D to re-prime it from the refresh cookie.

import { v4 as uuidv4 } from 'uuid';

import { authStore } from '@/store/auth.store';

export interface ApiSuccessEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.code;
    this.details = payload.details;
    this.requestId = payload.requestId;
  }
}

export interface RequestOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
  skipAuth?: boolean;
}

interface InternalRequestState {
  isRetry: boolean;
}

const REFRESH_PATH = '/api/v1/auth/refresh';
const TOKEN_EXPIRED_CODE = 'TOKEN_EXPIRED';

export class ApiClient {
  private readonly baseURL: string;
  private refreshPromise: Promise<void> | null = null;

  constructor(baseURL?: string) {
    this.baseURL = baseURL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
  }

  get<T>(path: string, options?: RequestOptions): Promise<ApiSuccessEnvelope<T>> {
    return this.request<T>('GET', path, undefined, options);
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiSuccessEnvelope<T>> {
    return this.request<T>('POST', path, body, options);
  }

  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<ApiSuccessEnvelope<T>> {
    return this.request<T>('PATCH', path, body, options);
  }

  delete<T>(path: string, options?: RequestOptions): Promise<ApiSuccessEnvelope<T>> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  upload<T>(
    path: string,
    formData: FormData,
    options?: RequestOptions,
  ): Promise<ApiSuccessEnvelope<T>> {
    return this.request<T>('POST', path, formData, options);
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    options: RequestOptions | undefined,
    internal: InternalRequestState = { isRetry: false },
  ): Promise<ApiSuccessEnvelope<T>> {
    const url = this.resolveUrl(path);
    const headers = this.buildHeaders(body, options);
    const init: RequestInit = {
      method,
      headers,
      credentials: 'include',
    };
    if (options?.signal) init.signal = options.signal;
    if (body !== undefined && body !== null) {
      init.body = body instanceof FormData ? body : JSON.stringify(body);
    }

    const response = await fetch(url, init);

    if (response.status === 401 && !internal.isRetry && !options?.skipAuth) {
      const errorPayload = await this.peekErrorPayload(response);
      if (errorPayload?.code === TOKEN_EXPIRED_CODE) {
        await this.handleRefresh();
        return this.request<T>(method, path, body, options, { isRetry: true });
      }
      throw new ApiError(response.status, errorPayload ?? unknownErrorPayload(response));
    }

    if (!response.ok) {
      const errorPayload = await this.peekErrorPayload(response);
      throw new ApiError(response.status, errorPayload ?? unknownErrorPayload(response));
    }

    if (response.status === 204) {
      return { data: undefined as unknown as T };
    }

    const json = (await response.json()) as ApiSuccessEnvelope<T>;
    return json;
  }

  private resolveUrl(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    if (path.startsWith('/api/')) return `${this.baseURL}${path}`;
    if (path.startsWith('/')) return `${this.baseURL}/api/v1${path}`;
    return `${this.baseURL}/api/v1/${path}`;
  }

  private buildHeaders(body: unknown, options: RequestOptions | undefined): Headers {
    const headers = new Headers();
    headers.set('Accept', 'application/json');
    headers.set('Accept-Language', 'fa-IR');
    headers.set('X-Request-Id', uuidv4());

    if (body !== undefined && body !== null && !(body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    if (!options?.skipAuth) {
      const token = authStore.getState().accessToken;
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }

    if (options?.idempotencyKey) {
      headers.set('Idempotency-Key', options.idempotencyKey);
    }

    return headers;
  }

  private async peekErrorPayload(response: Response): Promise<ApiErrorPayload | null> {
    try {
      const cloned = response.clone();
      const body = (await cloned.json()) as { error?: ApiErrorPayload };
      return body?.error ?? null;
    } catch {
      return null;
    }
  }

  private async handleRefresh(): Promise<void> {
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }
    this.refreshPromise = this.doRefresh();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefresh(): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.baseURL}${REFRESH_PATH}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'fa-IR',
          'X-Request-Id': uuidv4(),
        },
      });
    } catch (err) {
      this.failRefresh();
      throw err;
    }

    if (!response.ok) {
      this.failRefresh();
      const payload = (await this.peekErrorPayload(response)) ?? unknownErrorPayload(response);
      throw new ApiError(response.status, payload);
    }

    let body: ApiSuccessEnvelope<{ accessToken?: string }>;
    try {
      body = (await response.json()) as ApiSuccessEnvelope<{ accessToken?: string }>;
    } catch {
      this.failRefresh();
      throw new ApiError(response.status, {
        code: 'INVALID_REFRESH_RESPONSE',
        message: 'Refresh response was not valid JSON',
      });
    }

    const token = body?.data?.accessToken;
    if (typeof token !== 'string' || token.length === 0) {
      this.failRefresh();
      throw new ApiError(response.status, {
        code: 'INVALID_REFRESH_RESPONSE',
        message: 'Refresh response did not include an access token',
      });
    }

    authStore.setState({ accessToken: token });
  }

  private failRefresh(): void {
    authStore.setState({ accessToken: null });
    if (typeof window !== 'undefined' && window.location) {
      window.location.href = '/login';
    }
  }
}

function unknownErrorPayload(response: Response): ApiErrorPayload {
  return {
    code: 'UNKNOWN',
    message: response.statusText || `HTTP ${response.status}`,
  };
}

const apiClient = new ApiClient();
export default apiClient;
