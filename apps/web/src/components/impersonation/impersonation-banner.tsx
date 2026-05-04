'use client';

import { useMutation } from '@tanstack/react-query';
import { LoaderCircleIcon, UserCogIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { adminMutate } from '@/lib/admin-mutate';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth.store';

const BANNER_BODY_CLASS = 'impersonating';

function targetLabel(user: ReturnType<typeof useAuthStore.getState>['user']): string {
  if (!user) return '—';
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return name ? `${name} (${user.phone})` : user.phone;
}

function actorLabel(
  actor: ReturnType<typeof useAuthStore.getState>['impersonationActor'],
  fallbackId: string | null,
): string {
  if (!actor) return fallbackId ? `ادمین #${fallbackId}` : 'ادمین';
  const name = `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim();
  return name ? `${name} (${actor.phoneMasked})` : actor.phoneMasked;
}

export function ImpersonationBanner() {
  const router = useRouter();
  const isImpersonating = useAuthStore((s) => s.isImpersonating);
  const user = useAuthStore((s) => s.user);
  const impersonationActor = useAuthStore((s) => s.impersonationActor);
  const impersonationActorId = useAuthStore((s) => s.impersonationActorId);
  const bootstrap = useAuthStore((s) => s.bootstrap);

  // Toggle a body class so layout CSS can reserve space for the banner via a
  // single rule. Avoids prop-drilling and keeps every page (account, admin,
  // public) automatically in sync.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const body = document.body;
    if (isImpersonating) body.classList.add(BANNER_BODY_CLASS);
    else body.classList.remove(BANNER_BODY_CLASS);
    return () => {
      body.classList.remove(BANNER_BODY_CLASS);
    };
  }, [isImpersonating]);

  const stopMutation = useMutation({
    mutationFn: async () => {
      await adminMutate('POST', '/admin/impersonation/stop');
    },
    onSuccess: async () => {
      // Re-bootstrap from the admin's preserved refresh cookie. This swaps
      // the access token (and impersonation flags) back to the admin's own.
      await bootstrap();
      toast.success('شبیه‌سازی پایان یافت — به حساب ادمین بازگشتید');
      router.push('/admin/users');
    },
    onError: async (err) => {
      // If the impersonation token already expired, the stop call will 401.
      // Recover gracefully by bootstrapping anyway — the cookie still belongs
      // to the original admin and that's enough to get back.
      if (err instanceof ApiError && err.status === 401) {
        await bootstrap();
        router.push('/admin/users');
        return;
      }
      toast.error(err instanceof ApiError ? err.message : 'خطا در پایان شبیه‌سازی');
    },
  });

  if (!isImpersonating) return null;

  return (
    <div
      // SECURITY (UX): The banner is the *only* visual cue an admin has that
      // they're acting as someone else. Keep it sticky at viewport top, never
      // scroll-clip, and never let a child page hide it.
      className="fixed inset-x-0 top-0 z-[60] flex h-10 items-center gap-3 bg-[hsl(var(--primary))] px-3 text-sm text-white shadow-md"
      role="status"
      aria-live="polite"
    >
      <UserCogIcon className="size-4 shrink-0" />
      <span className="truncate font-medium">شبیه‌سازی به جای: {targetLabel(user)}</span>
      <span className="hidden text-white/80 sm:inline">
        — توسط {actorLabel(impersonationActor, impersonationActorId)}
      </span>
      <div className="ms-auto">
        <Button
          size="sm"
          variant="secondary"
          className="bg-white/15 text-white hover:bg-white/25"
          disabled={stopMutation.isPending}
          onClick={() => stopMutation.mutate()}
        >
          {stopMutation.isPending && <LoaderCircleIcon className="size-3 animate-spin" />}
          پایان شبیه‌سازی
        </Button>
      </div>
    </div>
  );
}
