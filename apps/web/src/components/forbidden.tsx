'use client';

import { ShieldAlertIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';

export function Forbidden() {
  const router = useRouter();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <ShieldAlertIcon className="text-primary size-12" />
      <h1 className="text-2xl font-semibold">دسترسی غیرمجاز</h1>
      <p className="text-muted-foreground text-sm">شما اجازه دسترسی به این بخش را ندارید.</p>
      <Button variant="outline" onClick={() => router.push('/dashboard')}>
        بازگشت به داشبورد
      </Button>
    </div>
  );
}
