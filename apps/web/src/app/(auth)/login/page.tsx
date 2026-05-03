'use client';

import { isValidIranianPhone, normalizeIranianPhone, toLatinDigits } from '@saziqo/persian-utils';
import { CheckIcon, LoaderCircleIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import apiClient, { ApiError } from '@/lib/api-client';
import { generateIdempotencyKey } from '@/lib/idempotency';

type ValidationState = 'empty' | 'invalid' | 'valid';

function getValidationState(value: string): ValidationState {
  if (value.length === 0) return 'empty';
  return isValidIranianPhone(value) ? 'valid' : 'invalid';
}

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const validation = getValidationState(toLatinDigits(phone));

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setPhone(toLatinDigits(e.target.value));
  }

  function startCountdownToast(seconds: number) {
    let remaining = seconds;
    const toastId = toast(`دوباره تلاش کنید در ${remaining} ثانیه`, {
      duration: seconds * 1000 + 500,
    });

    if (retryTimerRef.current) clearInterval(retryTimerRef.current);
    retryTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(retryTimerRef.current!);
        retryTimerRef.current = null;
        toast.dismiss(toastId);
        return;
      }
      toast(`دوباره تلاش کنید در ${remaining} ثانیه`, { id: toastId });
    }, 1000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const normalized = normalizeIranianPhone(toLatinDigits(phone));
    if (!normalized) return;

    setLoading(true);
    try {
      await apiClient.post(
        '/auth/otp/request',
        { phone: normalized },
        { skipAuth: true, idempotencyKey: generateIdempotencyKey() },
      );
      router.push(`/login/verify?phone=${encodeURIComponent(normalized)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'OTP_RATE_LIMITED') {
          const retryAfter =
            typeof (err.details as Record<string, unknown>)?.retryAfterSeconds === 'number'
              ? ((err.details as Record<string, unknown>).retryAfterSeconds as number)
              : 60;
          startCountdownToast(retryAfter);
        } else if (err.status === 429) {
          toast.error('تعداد درخواست‌ها زیاد است. لطفاً بعداً تلاش کنید.');
        } else {
          toast.error(err.message || 'خطا در ارسال درخواست');
        }
      } else {
        toast.error('خطا در ارسال درخواست');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold text-foreground">ورود یا ثبت‌نام</h1>
        <p className="text-muted-foreground text-sm">شماره موبایل خود را وارد کنید</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="phone">شماره موبایل</Label>
        <div className="relative">
          <Input
            id="phone"
            type="tel"
            dir="ltr"
            inputMode="numeric"
            placeholder="09123456789"
            value={phone}
            onChange={handleChange}
            autoComplete="tel"
            autoFocus
            className={
              validation === 'valid'
                ? 'border-green-500 focus-visible:ring-green-500 pe-9'
                : validation === 'invalid'
                  ? 'border-destructive focus-visible:ring-destructive pe-9'
                  : ''
            }
            disabled={loading}
            aria-describedby={validation === 'invalid' ? 'phone-error' : undefined}
          />
          {validation === 'valid' && (
            <CheckIcon className="absolute end-3 top-1/2 -translate-y-1/2 size-4 text-green-500 pointer-events-none" />
          )}
        </div>
        {validation === 'invalid' && (
          <p id="phone-error" className="text-destructive text-xs">
            شماره موبایل معتبر نیست (مثال: ۰۹۱۲۳۴۵۶۷۸۹)
          </p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={validation !== 'valid' || loading}>
        {loading ? (
          <>
            <LoaderCircleIcon className="animate-spin" />
            در حال ارسال…
          </>
        ) : (
          'دریافت کد تأیید'
        )}
      </Button>
    </form>
  );
}
