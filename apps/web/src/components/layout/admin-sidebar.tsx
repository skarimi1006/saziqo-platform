'use client';

import { useQuery } from '@tanstack/react-query';
import { ArchiveIcon, BanknoteIcon, FilesIcon, ShieldIcon, UsersIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { usePermission } from '@/hooks/use-permission';
import apiClient from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface AdminPageDefinition {
  href: string;
  titleFa: string;
  icon?: string;
  order?: number;
  requiredPermission?: string;
}

interface StaticNavItem {
  href: string;
  labelFa: string;
  icon: LucideIcon;
  permission: string;
}

const STATIC_ITEMS: StaticNavItem[] = [
  { href: '/admin/users', labelFa: 'کاربران', icon: UsersIcon, permission: 'admin:read:users' },
  {
    href: '/admin/audit',
    labelFa: 'گزارش حسابرسی',
    icon: FilesIcon,
    permission: 'admin:read:audit_log',
  },
  {
    href: '/admin/payouts',
    labelFa: 'صف تسویه',
    icon: BanknoteIcon,
    permission: 'admin:read:payouts',
  },
  {
    href: '/admin/payments',
    labelFa: 'پرداخت‌ها',
    icon: ShieldIcon,
    permission: 'admin:read:payouts',
  },
  {
    href: '/admin/refunds',
    labelFa: 'بازگشت وجه',
    icon: ArchiveIcon,
    permission: 'admin:read:payouts',
  },
];

function NavLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(href + '/');
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        isActive ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted',
        className,
      )}
    >
      {children}
    </Link>
  );
}

function StaticItem({ item }: { item: StaticNavItem }) {
  const allowed = usePermission(item.permission);
  if (!allowed) return null;
  const Icon = item.icon;
  return (
    <NavLink href={item.href}>
      <Icon className="size-4 shrink-0" />
      {item.labelFa}
    </NavLink>
  );
}

export function AdminSidebar() {
  const { data: dynamicPages } = useQuery<AdminPageDefinition[]>({
    queryKey: ['admin', 'registry', 'admin-pages'],
    queryFn: async () => {
      const res = await apiClient.get<AdminPageDefinition[]>('/admin/registry/admin-pages');
      return res.data;
    },
  });

  return (
    <nav className="flex flex-col gap-1 p-3">
      {STATIC_ITEMS.map((item) => (
        <StaticItem key={item.href} item={item} />
      ))}

      {dynamicPages && dynamicPages.length > 0 && (
        <>
          <div className="bg-border mx-3 my-1 h-px" />
          {dynamicPages.map((page) => (
            <NavLink key={page.href} href={page.href}>
              {page.titleFa}
            </NavLink>
          ))}
        </>
      )}
    </nav>
  );
}
