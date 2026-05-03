// Tests verify Phase 12D acceptance criteria:
//   - bootstrap() exchanges the refresh cookie for an access token,
//     fetches /users/me, and populates state
//   - bootstrap() on failure leaves the store cleared
//   - setAuth() seeds token + user and computes profileComplete +
//     impersonation flags
//   - clearAuth() resets every field
//   - refreshUser() updates user without touching the token
//
// Strategy: the store imports apiClient as the default export from
// '@/lib/api-client'. We vi.mock() that module before importing the
// store, so each test controls the exact responses.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-client', () => {
  // The real module also exports ApiError; the store narrows on it
  // inside bootstrap()'s catch, so the mock must keep the same export
  // surface (and constructor signature) as the real one.
  class ApiError extends Error {
    status: number;
    code: string;
    details: unknown;
    requestId: string | undefined;
    constructor(
      status: number,
      payload: { code: string; message: string; details?: unknown; requestId?: string },
    ) {
      super(payload.message);
      this.status = status;
      this.code = payload.code;
      this.details = payload.details;
      this.requestId = payload.requestId;
    }
  }
  return {
    default: {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      upload: vi.fn(),
    },
    ApiError,
  };
});

import { useAuthStore, type User } from './auth.store';

import apiClient, { ApiError } from '@/lib/api-client';


const mockedClient = apiClient as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  upload: ReturnType<typeof vi.fn>;
};

const ACTIVE_USER: User = {
  id: '7',
  phone: '+989121234567',
  firstName: 'علی',
  lastName: 'محمدی',
  nationalId: null,
  email: null,
  status: 'ACTIVE',
  roles: ['user'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const PENDING_USER: User = { ...ACTIVE_USER, status: 'PENDING_PROFILE' };

function makeJwt(payload: Record<string, unknown>): string {
  const enc = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.sig`;
}

describe('auth.store', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      profileComplete: false,
      isImpersonating: false,
      impersonationActorId: null,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('bootstrap', () => {
    it('on success: sets token, user, isAuthenticated, profileComplete', async () => {
      const token = makeJwt({ sub: '7' });
      mockedClient.post.mockResolvedValueOnce({ data: { accessToken: token } });
      mockedClient.get.mockResolvedValueOnce({ data: ACTIVE_USER });

      await useAuthStore.getState().bootstrap();

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe(token);
      expect(state.user).toEqual(ACTIVE_USER);
      expect(state.isAuthenticated).toBe(true);
      expect(state.profileComplete).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.isImpersonating).toBe(false);
      expect(state.impersonationActorId).toBeNull();

      expect(mockedClient.post).toHaveBeenCalledWith('/auth/refresh', null, {
        skipAuth: true,
      });
      expect(mockedClient.get).toHaveBeenCalledWith('/users/me');
    });

    it('profileComplete is false for non-ACTIVE users', async () => {
      const token = makeJwt({ sub: '7' });
      mockedClient.post.mockResolvedValueOnce({ data: { accessToken: token } });
      mockedClient.get.mockResolvedValueOnce({ data: PENDING_USER });

      await useAuthStore.getState().bootstrap();

      expect(useAuthStore.getState().profileComplete).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });

    it('reads the imp claim and exposes impersonation flags', async () => {
      const token = makeJwt({ sub: '7', imp: '99' });
      mockedClient.post.mockResolvedValueOnce({ data: { accessToken: token } });
      mockedClient.get.mockResolvedValueOnce({ data: ACTIVE_USER });

      await useAuthStore.getState().bootstrap();

      const state = useAuthStore.getState();
      expect(state.isImpersonating).toBe(true);
      expect(state.impersonationActorId).toBe('99');
    });

    it('on refresh failure: clears state, sets isLoading false', async () => {
      mockedClient.post.mockRejectedValueOnce(
        new ApiError(401, { code: 'SESSION_INVALID', message: 'gone' }),
      );

      await useAuthStore.getState().bootstrap();

      const state = useAuthStore.getState();
      expect(state.accessToken).toBeNull();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(mockedClient.get).not.toHaveBeenCalled();
    });

    it('on /users/me failure after refresh: clears state', async () => {
      const token = makeJwt({ sub: '7' });
      mockedClient.post.mockResolvedValueOnce({ data: { accessToken: token } });
      mockedClient.get.mockRejectedValueOnce(
        new ApiError(500, { code: 'INTERNAL_ERROR', message: 'boom' }),
      );

      await useAuthStore.getState().bootstrap();

      const state = useAuthStore.getState();
      expect(state.accessToken).toBeNull();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
    });

    it('sets isLoading true during the in-flight call', async () => {
      let resolveRefresh: ((v: unknown) => void) | undefined;
      mockedClient.post.mockReturnValueOnce(
        new Promise((r) => {
          resolveRefresh = r;
        }),
      );
      const promise = useAuthStore.getState().bootstrap();
      expect(useAuthStore.getState().isLoading).toBe(true);
      resolveRefresh?.({ data: { accessToken: makeJwt({ sub: '7' }) } });
      mockedClient.get.mockResolvedValueOnce({ data: ACTIVE_USER });
      await promise;
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe('setAuth', () => {
    it('seeds token + user and computes derived flags', () => {
      const token = makeJwt({ sub: '7' });
      useAuthStore.getState().setAuth(token, ACTIVE_USER);

      const state = useAuthStore.getState();
      expect(state.accessToken).toBe(token);
      expect(state.user).toEqual(ACTIVE_USER);
      expect(state.isAuthenticated).toBe(true);
      expect(state.profileComplete).toBe(true);
      expect(state.isImpersonating).toBe(false);
    });

    it('marks impersonation when the imp claim is present', () => {
      const token = makeJwt({ sub: '7', imp: '99' });
      useAuthStore.getState().setAuth(token, ACTIVE_USER);
      expect(useAuthStore.getState().isImpersonating).toBe(true);
      expect(useAuthStore.getState().impersonationActorId).toBe('99');
    });
  });

  describe('clearAuth', () => {
    it('zeros every field', () => {
      const token = makeJwt({ sub: '7', imp: '99' });
      useAuthStore.getState().setAuth(token, ACTIVE_USER);
      useAuthStore.getState().clearAuth();

      const state = useAuthStore.getState();
      expect(state).toMatchObject({
        accessToken: null,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        profileComplete: false,
        isImpersonating: false,
        impersonationActorId: null,
      });
    });
  });

  describe('refreshUser', () => {
    it('reloads /users/me and updates user + profileComplete', async () => {
      useAuthStore.getState().setAuth(makeJwt({ sub: '7' }), PENDING_USER);
      mockedClient.get.mockResolvedValueOnce({ data: ACTIVE_USER });

      await useAuthStore.getState().refreshUser();

      expect(useAuthStore.getState().user).toEqual(ACTIVE_USER);
      expect(useAuthStore.getState().profileComplete).toBe(true);
    });

    it('no-ops when there is no access token', async () => {
      await useAuthStore.getState().refreshUser();
      expect(mockedClient.get).not.toHaveBeenCalled();
    });
  });
});
