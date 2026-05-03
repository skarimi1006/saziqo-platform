'use client';

import { MenuIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { NAV_ITEMS } from '@/config/nav';
import { cn } from '@/lib/utils';

export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)}>
        <MenuIcon className="size-5" />
        <span className="sr-only">منو</span>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        {/* side="right" = start side in RTL */}
        <SheetContent side="right" className="w-64 p-0">
          <SheetTitle className="sr-only">منوی ناوبری</SheetTitle>
          <nav className="flex flex-col gap-1 p-3 pt-6">
            {NAV_ITEMS.map(({ href, labelFa, icon: Icon }) => {
              const isActive = pathname === href || pathname.startsWith(href + '/');
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-muted',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {labelFa}
                </Link>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
