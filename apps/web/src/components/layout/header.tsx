'use client';

import { UserIcon } from 'lucide-react';

import { MobileMenu } from './mobile-menu';

export function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-sm">
      {/* Start side (visual right in RTL): hamburger + logo */}
      <div className="flex items-center gap-2">
        <MobileMenu />
        <span className="text-lg font-bold text-primary">سازیکو</span>
      </div>

      {/* End side (visual left in RTL): user placeholder */}
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-full bg-muted">
          <UserIcon className="size-4 text-muted-foreground" />
        </div>
      </div>
    </header>
  );
}
