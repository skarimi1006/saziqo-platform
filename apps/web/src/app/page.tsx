import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-3xl font-semibold text-foreground">سازیکو در حال راه‌اندازی</h1>
      <Button>شروع</Button>
    </main>
  );
}
