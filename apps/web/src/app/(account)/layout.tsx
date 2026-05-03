'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuth } from '@/hooks/use-auth';

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) return null;

  return <main className="container mx-auto max-w-2xl px-4 py-12">{children}</main>;
}
