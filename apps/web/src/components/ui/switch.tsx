'use client';

// CLAUDE: RTL fix from stock shadcn new-york switch:
//   The thumb's translate-x value was hard-coded `translate-x-[calc(100%-2px)]`
//   for the checked state and `translate-x-0` for the unchecked state.
//   Under `dir="rtl"` that puts the OFF thumb on the visual LEFT and
//   the ON thumb on the visual RIGHT — backwards for an RTL reader who
//   expects "off → start (visual right)" and "on → end (visual left)".
//
//   We invert the sign in RTL via Tailwind's `rtl:` variant. The thumb
//   uses translate-x for LTR and `rtl:-translate-x-*` for RTL, and the
//   checked offset becomes negative in RTL too. Net result: thumb sits
//   on the visual right when off, animates to the visual left when on,
//   regardless of writing direction.

import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as React from 'react';

import { cn } from '@/lib/utils';

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform',
          // LTR: off → translate-x-0; on → translate-x to the right
          'data-[state=unchecked]:translate-x-0 data-[state=checked]:translate-x-[calc(100%-2px)]',
          // RTL inversion: off thumb stays on the visual right (start
          // edge), on thumb slides to the visual left (end edge).
          'rtl:data-[state=unchecked]:-translate-x-0 rtl:data-[state=checked]:-translate-x-[calc(100%-2px)]',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
