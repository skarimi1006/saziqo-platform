'use client';

import { useRouter } from 'next/navigation';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/use-auth';
import apiClient from '@/lib/api-client';
import { logout } from '@/lib/logout';
import { useAuthStore } from '@/store/auth.store';

function getInitial(firstName: string | null): string {
  if (!firstName) return '؟';
  const cp = firstName.codePointAt(0);
  return cp !== undefined ? String.fromCodePoint(cp) : (firstName[0] ?? '؟');
}

export function UserMenu() {
  const router = useRouter();
  const { user, isImpersonating } = useAuth();

  const stopImpersonation = async () => {
    await apiClient.post('/admin/impersonation/stop', null);
    await useAuthStore.getState().refreshUser();
    router.push('/dashboard');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Avatar className="size-8 cursor-pointer">
            <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
              {getInitial(user?.firstName ?? null)}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-48">
        {user && (
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium truncate">
              {user.firstName} {user.lastName}
            </p>
            <p className="text-muted-foreground text-xs truncate">{user.phone}</p>
          </div>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => router.push('/settings/profile')}>
          پروفایل
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push('/settings/sessions')}>
          نشست‌ها
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push('/wallet')}>کیف پول</DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => void logout()}
        >
          خروج
        </DropdownMenuItem>

        {isImpersonating && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 bg-orange-50 rounded-sm mx-1">
              <p className="text-xs text-orange-700 mb-1">
                در حال شبیه‌سازی به جای کاربر #{user?.id}
              </p>
              <button
                className="text-xs font-medium text-primary hover:underline"
                onClick={() => void stopImpersonation()}
              >
                پایان شبیه‌سازی
              </button>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
