'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Forbidden } from '@/components/forbidden';
import { AdminSidebar } from '@/components/layout/admin-sidebar';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/hooks/use-auth';
import { usePermission } from '@/hooks/use-permission';

function LoadingSkeleton() {
  return (
    <div className="min-h-screen animate-pulse">
      <div
        className="fixed inset-x-0 z-40 h-14 border-b bg-muted"
        style={{ top: 'var(--impersonation-banner-height)' }}
      />
      <div
        className="fixed bottom-0 start-0 hidden w-64 border-e bg-muted md:block"
        style={{ top: 'calc(var(--impersonation-banner-height) + 3.5rem)' }}
      />
      <div
        className="md:ms-64"
        style={{ paddingTop: 'calc(var(--impersonation-banner-height) + 3.5rem)' }}
      >
        <div className="space-y-3 p-6">
          <div className="h-8 w-48 rounded-lg bg-muted" />
          <div className="h-4 w-full rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const hasAdminAccess = usePermission('admin:read:users');

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) return <LoadingSkeleton />;
  if (!isAuthenticated) return null;
  if (!hasAdminAccess) return <Forbidden />;

  return <AppShell sidebar={<AdminSidebar />}>{children}</AppShell>;
}
