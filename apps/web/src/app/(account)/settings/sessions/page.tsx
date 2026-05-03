'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircleIcon, MonitorIcon, SmartphoneIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { UAParser } from 'ua-parser-js';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import apiClient, { ApiError } from '@/lib/api-client';
import { formatJalaliRelative } from '@/lib/dates';
import { decodeJwtPayload } from '@/lib/jwt-decode';
import { useAuthStore } from '@/store/auth.store';

interface Session {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
}

function maskIp(ip: string | null): string {
  if (!ip) return '—';
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.*. ${parts[3]}`.replace(' ', '');
  }
  return ip;
}

function parseDevice(userAgent: string | null): { label: string; isMobile: boolean } {
  if (!userAgent) return { label: 'دستگاه ناشناس', isMobile: false };
  const parser = new UAParser(userAgent);
  const browser = parser.getBrowser().name ?? 'مرورگر ناشناس';
  const os = parser.getOS().name ?? 'سیستم‌عامل ناشناس';
  const device = parser.getDevice();
  const isMobile = device.type === 'mobile' || device.type === 'tablet';
  return { label: `${browser} — ${os}`, isMobile };
}

function currentSessionId(): string | null {
  const token = useAuthStore.getState().accessToken;
  if (!token) return null;
  const payload = decodeJwtPayload<{ sid?: string }>(token);
  return payload?.sid ?? null;
}

export default function SessionsPage() {
  const qc = useQueryClient();
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);

  const { data, isLoading, error } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await apiClient.get<Session[]>('/users/me/sessions');
      return res.data;
    },
  });

  const currentSid = currentSessionId();

  const revokeOne = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/users/me/sessions/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('نشست با موفقیت خارج شد');
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'خطا در خروج از نشست';
      toast.error(msg);
    },
  });

  const revokeAll = useMutation({
    mutationFn: () => apiClient.delete('/users/me/sessions'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('همه نشست‌های دیگر خاتمه یافتند');
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'خطا در خروج از نشست‌ها';
      toast.error(msg);
    },
  });

  const sessions = data ?? [];
  const otherSessions = sessions.filter((s) => s.id !== currentSid);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">نشست‌های فعال</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            دستگاه‌هایی که به حساب شما وارد شده‌اند.
          </p>
        </div>

        {otherSessions.length > 0 && (
          <AlertDialog open={revokeAllOpen} onOpenChange={setRevokeAllOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                خروج از همه دستگاه‌های دیگر
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>خروج از همه دستگاه‌های دیگر</AlertDialogTitle>
                <AlertDialogDescription>
                  از تمام نشست‌های دیگر خارج خواهید شد. نشست فعلی شما حفظ می‌ماند.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>انصراف</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    revokeAll.mutate();
                    setRevokeAllOpen(false);
                  }}
                >
                  تأیید
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </header>

      {isLoading && (
        <div className="flex justify-center py-12">
          <LoaderCircleIcon className="text-muted-foreground animate-spin size-6" />
        </div>
      )}

      {error && (
        <p className="text-destructive text-sm">
          {error instanceof ApiError ? error.message : 'خطا در بارگذاری نشست‌ها'}
        </p>
      )}

      {!isLoading && !error && sessions.length === 0 && (
        <p className="text-muted-foreground text-sm">هیچ نشست فعالی یافت نشد.</p>
      )}

      <div className="flex flex-col gap-3">
        {sessions.map((session) => {
          const isCurrent = session.id === currentSid;
          const { label, isMobile } = parseDevice(session.userAgent);
          const DeviceIcon = isMobile ? SmartphoneIcon : MonitorIcon;

          return (
            <Card key={session.id}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <DeviceIcon className="text-muted-foreground mt-0.5 size-5 shrink-0" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{label}</span>
                      {isCurrent && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          دستگاه فعلی
                        </span>
                      )}
                    </div>
                    <span className="text-muted-foreground text-xs" dir="ltr">
                      {maskIp(session.ipAddress)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {formatJalaliRelative(session.createdAt)}
                    </span>
                  </div>
                </div>

                {!isCurrent && (
                  <RevokeButton
                    isPending={revokeOne.isPending && revokeOne.variables === session.id}
                    onConfirm={() => revokeOne.mutate(session.id)}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function RevokeButton({ isPending, onConfirm }: { isPending: boolean; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={isPending}>
          {isPending ? <LoaderCircleIcon className="animate-spin size-4" /> : 'خروج'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>خروج از نشست</AlertDialogTitle>
          <AlertDialogDescription>آیا از خروج این نشست مطمئن هستید؟</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>انصراف</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onConfirm();
              setOpen(false);
            }}
          >
            تأیید
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
