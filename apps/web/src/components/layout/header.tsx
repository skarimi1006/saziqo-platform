'use client';

import { MobileMenu } from './mobile-menu';

import { Logo } from '@/components/brand/logo';
import { UserMenu } from '@/components/user-menu/user-menu';


export function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-sm">
      {/* Start side (visual right in RTL): hamburger + logo */}
      <div className="flex items-center gap-2">
        <MobileMenu />
        <Logo size="md" variant="dark" />
      </div>

      {/* End side (visual left in RTL): user menu */}
      <UserMenu />
    </header>
  );
}
