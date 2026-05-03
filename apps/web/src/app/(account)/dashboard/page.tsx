'use client';

import { useAuth } from '@/hooks/use-auth';

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">
        خوش آمدید{user?.firstName ? `، ${user.firstName}` : ''}
      </h1>
      <p className="text-muted-foreground text-sm">به پنل مدیریت سازیکو خوش آمدید.</p>
    </div>
  );
}
