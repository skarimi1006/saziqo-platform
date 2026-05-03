import { LayoutDashboard, Monitor, User, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  labelFa: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', labelFa: 'داشبورد', icon: LayoutDashboard },
  { href: '/wallet', labelFa: 'کیف پول', icon: Wallet },
  { href: '/settings/profile', labelFa: 'پروفایل', icon: User },
  { href: '/settings/sessions', labelFa: 'نشست‌ها', icon: Monitor },
];
