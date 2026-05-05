import { cn } from '@/lib/utils';

interface LogoProps {
  variant?: 'dark' | 'light';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const TEXT_SIZE = {
  sm: 'text-sm',
  md: 'text-lg',
  lg: 'text-2xl',
} as const;

const DOT_SIZE = {
  sm: 'size-1.5',
  md: 'size-2',
  lg: 'size-3',
} as const;

const TEXT_COLOR = {
  dark: 'text-foreground',
  light: 'text-white',
} as const;

const GAP_SIZE = {
  sm: 'gap-1',
  md: 'gap-1.5',
  lg: 'gap-2',
} as const;

export function Logo({ variant = 'dark', size = 'md', className }: LogoProps) {
  return (
    <span
      className={cn('inline-flex items-center', GAP_SIZE[size], className)}
      role="img"
      aria-label="سازیکو"
    >
      <span
        aria-hidden="true"
        className={cn('inline-block shrink-0 rounded-full bg-primary', DOT_SIZE[size])}
      />
      <span
        className={cn(
          'font-extrabold leading-none tracking-tight',
          TEXT_SIZE[size],
          TEXT_COLOR[variant],
        )}
      >
        سازیکو
      </span>
    </span>
  );
}
