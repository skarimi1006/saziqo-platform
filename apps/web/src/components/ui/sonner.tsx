'use client';

// CLAUDE: RTL fix — sonner defaults to position="top-right", which lands
// in the visual top-RIGHT regardless of dir. In a Persian RTL UI the
// "start corner" lives on the visual right (where the sidebar / nav
// usually anchor), so we move toasts to "top-left" so they don't
// collide with primary navigation. dir="rtl" also makes the close
// button and icon spacing inside each toast respect the RTL flow.
// Callers can still override via props.

import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

function Toaster({ position = 'top-left', dir = 'rtl', ...props }: ToasterProps) {
  const { theme } = useTheme();
  const resolvedTheme: 'system' | 'light' | 'dark' =
    theme === 'light' || theme === 'dark' ? theme : 'system';

  return (
    <Sonner
      theme={resolvedTheme}
      position={position}
      dir={dir}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
