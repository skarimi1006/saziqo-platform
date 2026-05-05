'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/hooks/use-auth';

export function AuthLayoutClient({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isLoading, profileComplete } = useAuth();

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    router.replace(profileComplete ? '/dashboard' : '/onboarding/profile');
  }, [isAuthenticated, isLoading, profileComplete, router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg-soft px-4">
      <div className="mb-8 flex flex-col items-center gap-3">
        <span className="text-4xl font-extrabold text-primary leading-none tracking-tight">
          سازیکو
        </span>
        <p className="text-muted-foreground text-sm">پلتفرم ساخت کسب‌وکار با هوش مصنوعی</p>
      </div>

      <div className="w-full max-w-md rounded-xl border bg-background p-8 shadow-sm">
        {isLoading || isAuthenticated ? null : children}
      </div>
    </main>
  );
}
