'use client';

import { useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircleIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import apiClient, { ApiError } from '@/lib/api-client';
import { formatJalaliRelative } from '@/lib/dates';

interface NotificationItem {
  id: string;
  renderedTitle: string;
  renderedBody: string;
  createdAt: string;
  readAt: string | null;
  payload?: { deepLink?: string };
}

interface NotificationsPage {
  data: NotificationItem[];
  meta: {
    pagination: { nextCursor?: string; limit: number };
    hasMore: boolean;
  };
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const router = useRouter();

  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery<NotificationsPage>({
      queryKey: ['notifications', 'all'],
      queryFn: async ({ pageParam }) => {
        const cursor = pageParam ? `&cursor=${pageParam as string}` : '';
        const res = await apiClient.get<NotificationsPage>(
          `/users/me/notifications?limit=50${cursor}`,
        );
        return res.data;
      },
      initialPageParam: undefined,
      getNextPageParam: (last) => (last.meta.hasMore ? last.meta.pagination.nextCursor : undefined),
    });

  const markRead = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/users/me/notifications/${id}/read`, null),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const allItems = data?.pages.flatMap((p) => p.data) ?? [];

  const handleClick = (n: NotificationItem) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.payload?.deepLink) router.push(n.payload.deepLink);
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">اعلان‌ها</h1>
        <p className="text-muted-foreground mt-1 text-sm">همه اعلان‌های شما</p>
      </header>

      {isLoading && (
        <div className="flex justify-center py-12">
          <LoaderCircleIcon className="text-muted-foreground animate-spin size-6" />
        </div>
      )}

      {error && (
        <p className="text-destructive text-sm">
          {error instanceof ApiError ? error.message : 'خطا در بارگذاری اعلان‌ها'}
        </p>
      )}

      {!isLoading && !error && allItems.length === 0 && (
        <p className="text-muted-foreground text-sm">هیچ اعلانی یافت نشد.</p>
      )}

      <div className="flex flex-col gap-2">
        {allItems.map((n) => (
          <Card
            key={n.id}
            className={`cursor-pointer transition-colors ${n.readAt ? 'opacity-60' : ''}`}
            onClick={() => handleClick(n)}
          >
            <CardContent className="flex flex-col gap-1 p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium">{n.renderedTitle}</span>
                {!n.readAt && <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />}
              </div>
              <p className="text-muted-foreground text-sm">{n.renderedBody}</p>
              <span className="text-muted-foreground text-xs">
                {formatJalaliRelative(n.createdAt)}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? (
              <LoaderCircleIcon className="animate-spin size-4" />
            ) : (
              'بارگذاری بیشتر'
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
