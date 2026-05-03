import apiClient from '@/lib/api-client';
import { useAuthStore } from '@/store/auth.store';

// Called by user-menu components. The caller is responsible for showing a
// success toast before invoking this function, as window.location.href
// triggers a hard navigation that unmounts the current React tree.
export async function logout(): Promise<void> {
  try {
    await apiClient.post('/auth/logout', null);
  } catch {
    // Best-effort: always clear local state even if API is unreachable.
  }
  useAuthStore.getState().clearAuth();
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}
