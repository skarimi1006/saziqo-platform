import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0f172a',
          2: '#1f2937',
          3: '#334155',
          dim: '#64748b',
          faint: '#94a3b8',
        },
        line: {
          DEFAULT: '#e2e8f0',
          strong: '#cbd5e1',
        },
        orange: {
          DEFAULT: '#f97316',
          soft: '#ffedd5',
          deep: '#ea580c',
          faint: '#fff7ed',
        },
        bg: {
          DEFAULT: '#ffffff',
          soft: '#f8fafc',
          section: '#f1f5f9',
        },
      },
      fontFamily: {
        sans: ['var(--font-vazirmatn)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
      },
    },
  },
  plugins: [],
};

export default config;
