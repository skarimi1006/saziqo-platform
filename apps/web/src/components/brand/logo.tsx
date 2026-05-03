interface LogoProps {
  variant?: 'dark' | 'light';
  size?: 'sm' | 'md' | 'lg';
}

const SIZE = {
  sm: { height: 24, dotR: 5, fontSize: 14, gap: 5 },
  md: { height: 32, dotR: 6, fontSize: 18, gap: 6 },
  lg: { height: 48, dotR: 9, fontSize: 26, gap: 8 },
} as const;

const TEXT_COLOR = {
  dark: '#0f172a',
  light: '#ffffff',
} as const;

export function Logo({ variant = 'dark', size = 'md' }: LogoProps) {
  const { height, dotR, fontSize, gap } = SIZE[size];
  const dotDiameter = dotR * 2;
  const totalWidth = dotDiameter + gap + fontSize * 3.6; // rough estimate for "سازیکو"
  const cy = height / 2;

  return (
    <svg
      height={height}
      width={totalWidth}
      viewBox={`0 0 ${totalWidth} ${height}`}
      aria-label="سازیکو"
      role="img"
      direction="rtl"
    >
      {/* Dot mark — on the start (right) side in RTL, but SVG is LTR-coordinate,
          so we put it at x-end of the SVG and text extends left from it */}
      <circle cx={totalWidth - dotR} cy={cy} r={dotR} fill="#f97316" />

      {/* Wordmark — right-aligned text ending just before the dot */}
      <text
        x={totalWidth - dotDiameter - gap}
        y={cy}
        dominantBaseline="middle"
        textAnchor="end"
        fontSize={fontSize}
        fontWeight={800}
        fontFamily="var(--font-vazirmatn), system-ui, sans-serif"
        fill={TEXT_COLOR[variant]}
      >
        سازیکو
      </text>
    </svg>
  );
}
