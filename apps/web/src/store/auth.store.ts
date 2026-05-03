// CLAUDE: Source of truth for client-side auth state. Read by every
// guarded route via the useAuth hook. The api-client (Phase 12C) reads
// `accessToken` and writes it back on refresh — keep `getState` /
// `setState` semantics intact so that contract holds.
//
// SECURITY: Refresh tokens stay in an httpOnly cookie set by the API.
// We never persist `accessToken` to localStorage; bootstrap() exchanges
// the cookie for a fresh token on every page load. Reload-loop is
// avoided because bootstrap() short-circuits when there's no cookie
// (refresh returns 401 → clearAuth → isLoading: false).

import { create } from 'zustand';

import apiClient, { ApiError } from '@/lib/api-client';
import { decodeJwtPayload } from '@/lib/jwt-decode';

export type UserStatus = 'PENDING_PROFILE' | 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export interface User {
  id: string;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  nationalId: string | null;
  email: string | null;
  status: UserStatus;
  roles: string[];
  createdAt: string;
}

interface RefreshResponse {
  accessToken: string;
}

export interface AuthState {
  accessToken: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  profileComplete: boolean;
  isImpersonating: boolean;
  impersonationActorId: string | null;

  bootstrap: () => Promise<void>;
  setAuth: (accessToken: string, user: User) => void;
  clearAuth: () => void;
  refreshUser: () => Promise<void>;
}

const initialState = {
  accessToken: null,
  user: null,
  isAuthenticated: false,
  isLoading: false,
  profileComplete: false,
  isImpersonating: false,
  impersonationActorId: null as string | null,
};

function impersonationFromToken(token: string): {
  isImpersonating: boolean;
  impersonationActorId: string | null;
} {
  const payload = decodeJwtPayload<{ imp?: string }>(token);
  const imp = payload?.imp;
  if (typeof imp === 'string' && imp.length > 0) {
    return { isImpersonating: true, impersonationActorId: imp };
  }
  return { isImpersonating: false, impersonationActorId: null };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  ...initialState,

  async bootstrap() {
    set({ isLoading: true });
    try {
      const refresh = await apiClient.post<RefreshResponse>('/auth/refresh', null, {
        skipAuth: true,
      });
      const token = refresh.data.accessToken;
      const me = await apiClient.get<User>('/users/me');
      const user = me.data;
      const { isImpersonating, impersonationActorId } = impersonationFromToken(token);
      set({
        accessToken: token,
        user,
        isAuthenticated: true,
        profileComplete: user.status === 'ACTIVE',
        isImpersonating,
        impersonationActorId,
      });
    } catch (err) {
      // Any failure (no cookie, expired refresh, /users/me 5xx) leaves
      // the user logged-out. Surfacing the original error would force
      // every consumer to handle it; bootstrap is fire-and-forget.
      if (!(err instanceof ApiError)) {
        // Unknown failure — log so we notice in dev tools, but don't crash.
        // eslint-disable-next-line no-console
        console.error('[auth] bootstrap failed', err);
      }
      get().clearAuth();
    } finally {
      set({ isLoading: false });
      // Test Gate 12 marker — observable signal that bootstrap completed
      // (regardless of auth outcome). Kept as `console.log` so dev tools
      // surface it; suppressed in release builds via the marker strip.
      // eslint-disable-next-line no-console
      console.log('[auth] bootstrap done');
    }
  },

  setAuth(accessToken, user) {
    const { isImpersonating, impersonationActorId } = impersonationFromToken(accessToken);
    set({
      accessToken,
      user,
      isAuthenticated: true,
      profileComplete: user.status === 'ACTIVE',
      isImpersonating,
      impersonationActorId,
    });
  },

  clearAuth() {
    set({ ...initialState });
  },

  async refreshUser() {
    const { accessToken } = get();
    if (!accessToken) return;
    const me = await apiClient.get<User>('/users/me');
    set({
      user: me.data,
      profileComplete: me.data.status === 'ACTIVE',
    });
  },
}));

// CLAUDE: Phase 12C api-client reads tokens via this Zustand-compatible
// shim. Kept as a named export so 12C tests + any non-React module can
// stay framework-agnostic (no React hook calls).
export const authStore = {
  getState: () => {
    const s = useAuthStore.getState();
    return { accessToken: s.accessToken };
  },
  setState: (partial: { accessToken?: string | null }) => {
    if ('accessToken' in partial) {
      useAuthStore.setState({ accessToken: partial.accessToken ?? null });
    }
  },
  subscribe: (listener: (s: { accessToken: string | null }) => void) =>
    useAuthStore.subscribe((s) => listener({ accessToken: s.accessToken })),
  __resetForTests: () => {
    useAuthStore.setState({ ...initialState });
  },
};
