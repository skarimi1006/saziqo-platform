// CLAUDE: Minimal vanilla store seeded for Phase 12C. Phase 12D replaces
// this with a real Zustand store carrying { user, isAuthenticated,
// isLoading, profileComplete, isImpersonating, … } plus bootstrap /
// setAuth / clearAuth / refreshUser actions. The interface below
// (getState / setState / subscribe) is intentionally Zustand-compatible
// so the api-client doesn't need to change when 12D lands.

export interface AuthState {
  accessToken: string | null;
}

let state: AuthState = { accessToken: null };
const listeners = new Set<(s: AuthState) => void>();

export const authStore = {
  getState: (): AuthState => state,
  setState: (partial: Partial<AuthState>): void => {
    state = { ...state, ...partial };
    for (const listener of listeners) listener(state);
  },
  subscribe: (listener: (s: AuthState) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Test-only helper. Not exported from the index of public APIs. */
  __resetForTests: (): void => {
    state = { accessToken: null };
  },
};
