import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ورود به سازیکو',
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg-soft px-4">
      <div className="mb-8 flex flex-col items-center gap-3">
        <span className="text-4xl font-extrabold text-primary leading-none tracking-tight">
          سازیکو
        </span>
        <p className="text-muted-foreground text-sm">پلتفرم ساخت کسب‌وکار با هوش مصنوعی</p>
      </div>

      <div className="w-full max-w-md rounded-xl border bg-background p-8 shadow-sm">
        {children}
      </div>
    </main>
  );
}
