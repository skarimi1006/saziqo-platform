'use client';

import { useQuery } from '@tanstack/react-query';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import apiClient from '@/lib/api-client';

export default function AdminDashboardPage() {
  const { data: usersData } = useQuery({
    queryKey: ['admin', 'users', 'count'],
    queryFn: async () => {
      const res = await apiClient.get<{
        meta: { pagination: { nextCursor?: string } };
        data: unknown[];
      }>('/admin/users?limit=1');
      return res.data;
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">داشبورد مدیریت</h1>
        <p className="text-muted-foreground mt-1 text-sm">خلاصه وضعیت سیستم</p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">کاربران</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {usersData ? 'داده‌ها بارگذاری شد' : 'در حال بارگذاری...'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">پرداخت‌های امروز</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">—</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">نشست‌های فعال</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">—</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
