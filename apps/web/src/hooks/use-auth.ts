// CLAUDE: Read-only view of the auth store. Each call uses Zustand's
// per-field selector so a component that only reads `user` won't
// re-render when, say, `isLoading` flips. If a consumer truly needs
// imperative actions (login flow, logout button), import them directly
// via `useAuthStore.getState().setAuth(...)` rather than expanding this
// hook — the shape here is the public read-only contract.

import { useAuthStore } from '@/store/auth.store';

export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const profileComplete = useAuthStore((s) => s.profileComplete);
  const isImpersonating = useAuthStore((s) => s.isImpersonating);
  const impersonationActorId = useAuthStore((s) => s.impersonationActorId);

  return {
    user,
    accessToken,
    isAuthenticated,
    isLoading,
    profileComplete,
    isImpersonating,
    impersonationActorId,
  };
}
