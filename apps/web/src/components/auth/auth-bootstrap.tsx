'use client';

// CLAUDE: Mounted once at the root of the layout. Fires bootstrap()
// exactly once per page load — the ref guard exists because React
// Strict Mode mounts effects twice in dev, and we don't want two
// concurrent /auth/refresh calls racing each other.

import { useEffect, useRef } from 'react';

import { useAuthStore } from '@/store/auth.store';

export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const hasBootstrapped = useRef(false);

  useEffect(() => {
    if (hasBootstrapped.current) return;
    hasBootstrapped.current = true;
    void useAuthStore.getState().bootstrap();
  }, []);

  return <>{children}</>;
}
