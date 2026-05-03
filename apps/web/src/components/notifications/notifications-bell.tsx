'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellIcon, LoaderCircleIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import apiClient from '@/lib/api-client';
import { formatJalaliRelative } from '@/lib/dates';

interface NotificationItem {
  id: string;
  renderedTitle: string;
  renderedBody: string;
  createdAt: string;
  readAt: string | null;
  payload?: { deepLink?: string };
}

interface CountResponse {
  count: number;
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const router = useRouter();

  const { data: countData } = useQuery<CountResponse>({
    queryKey: ['notifications', 'count-unread'],
    queryFn: async () => {
      const res = await apiClient.get<CountResponse>('/users/me/notifications/count-unread');
      return res.data;
    },
    refetchInterval: 30_000,
  });

  const { data: latestData, isLoading: latestLoading } = useQuery<NotificationItem[]>({
    queryKey: ['notifications', 'latest-unread'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: NotificationItem[] }>(
        '/users/me/notifications?unreadOnly=true&limit=10',
      );
      return res.data.data;
    },
    enabled: open,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/users/me/notifications/${id}/read`, null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => apiClient.patch('/users/me/notifications/read-all', null),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const unreadCount = countData?.count ?? 0;
  const notifications = latestData ?? [];

  const handleRowClick = (n: NotificationItem) => {
    markRead.mutate(n.id);
    const deepLink = n.payload?.deepLink;
    if (deepLink) router.push(deepLink);
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <BellIcon className="size-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-0.5 -end-0.5 flex size-4 items-center justify-center rounded-full p-0 text-[10px]"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
          <span className="sr-only">اعلان‌ها</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm font-semibold">اعلان‌ها</span>
          {unreadCount > 0 && (
            <button
              className="text-muted-foreground hover:text-foreground text-xs"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              علامت‌گذاری همه به‌عنوان خوانده‌شده
            </button>
          )}
        </div>
        <Separator />

        <div className="max-h-80 overflow-y-auto">
          {latestLoading && (
            <div className="flex justify-center py-6">
              <LoaderCircleIcon className="text-muted-foreground animate-spin size-5" />
            </div>
          )}

          {!latestLoading && notifications.length === 0 && (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">
              اعلان خوانده‌نشده‌ای وجود ندارد
            </p>
          )}

          {notifications.map((n) => (
            <button
              key={n.id}
              className="hover:bg-muted flex w-full flex-col gap-0.5 px-3 py-2.5 text-start transition-colors"
              onClick={() => handleRowClick(n)}
            >
              <span className="text-sm font-medium">{n.renderedTitle}</span>
              <span className="text-muted-foreground line-clamp-2 text-sm">{n.renderedBody}</span>
              <span className="text-muted-foreground text-xs">
                {formatJalaliRelative(n.createdAt)}
              </span>
            </button>
          ))}
        </div>

        <Separator />
        <div className="p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              router.push('/notifications');
              setOpen(false);
            }}
          >
            مشاهده همه اعلان‌ها
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
