'use client';

import { isValidIranianPhone, toLatinDigits, toPersianDigits } from '@saziqo/persian-utils';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { LoaderCircleIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import apiClient, { ApiError } from '@/lib/api-client';
import { generateIdempotencyKey } from '@/lib/idempotency';
import { useAuthStore, type User } from '@/store/auth.store';

const OTP_TTL_SECONDS = 120;

interface OtpVerifyResponse {
  accessToken: string;
  user: User;
  profileComplete?: boolean;
}

function persianMessageForOtpError(err: ApiError): string {
  switch (err.code) {
    case 'OTP_INVALID':
      return 'کد وارد شده نادرست است';
    case 'OTP_EXPIRED':
      return 'کد منقضی شده است. کد جدید درخواست کنید';
    case 'OTP_TOO_MANY_ATTEMPTS':
      return 'تعداد تلاش‌ها بیش از حد. کد جدید درخواست کنید';
    case 'OTP_RATE_LIMITED': {
      const seconds =
        typeof (err.details as Record<string, unknown>)?.retryAfterSeconds === 'number'
          ? ((err.details as Record<string, unknown>).retryAfterSeconds as number)
          : 60;
      return `لطفاً ${seconds} ثانیه صبر کنید`;
    }
    default:
      return err.message || 'خطایی رخ داد. دوباره تلاش کنید';
  }
}

function VerifyForm({ phone }: { phone: string }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(OTP_TTL_SECONDS);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev <= 0 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleVerify = useCallback(
    async (submittedCode: string) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setIsSubmitting(true);
      try {
        const response = await apiClient.post<OtpVerifyResponse>(
          '/auth/otp/verify',
          { phone, code: submittedCode },
          { skipAuth: true, idempotencyKey: generateIdempotencyKey() },
        );
        const { accessToken, user, profileComplete } = response.data;
        useAuthStore.getState().setAuth(accessToken, user);
        const completed = profileComplete ?? user.status === 'ACTIVE';
        router.push(completed ? '/dashboard' : '/onboarding/profile');
      } catch (err) {
        if (err instanceof ApiError) {
          toast.error(persianMessageForOtpError(err));
        } else {
          toast.error('خطا در تأیید کد');
        }
        setCode('');
        submittedRef.current = false;
        setIsSubmitting(false);
      }
    },
    [phone, router],
  );

  function handleChange(next: string) {
    const latin = toLatinDigits(next);
    setCode(latin);
  }

  async function handleResend() {
    setIsResending(true);
    try {
      await apiClient.post(
        '/auth/otp/request',
        { phone },
        { skipAuth: true, idempotencyKey: generateIdempotencyKey() },
      );
      setCode('');
      setCountdown(OTP_TTL_SECONDS);
      toast.success('کد جدید ارسال شد');
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(persianMessageForOtpError(err));
      } else {
        toast.error('خطا در ارسال مجدد کد');
      }
    } finally {
      setIsResending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold text-foreground">کد تأیید</h1>
        <p className="text-muted-foreground text-sm">
          کد ۶ رقمی ارسال شده به <span dir="ltr">{phone}</span> را وارد کنید
        </p>
      </div>

      <div dir="ltr" className="flex justify-center">
        <InputOTP
          maxLength={6}
          pattern={REGEXP_ONLY_DIGITS}
          inputMode="numeric"
          value={code}
          onChange={handleChange}
          onComplete={(value) => void handleVerify(toLatinDigits(value))}
          disabled={isSubmitting}
          autoFocus
        >
          <InputOTPGroup>
            <InputOTPSlot index={0} className="size-12 text-lg" />
            <InputOTPSlot index={1} className="size-12 text-lg" />
            <InputOTPSlot index={2} className="size-12 text-lg" />
            <InputOTPSlot index={3} className="size-12 text-lg" />
            <InputOTPSlot index={4} className="size-12 text-lg" />
            <InputOTPSlot index={5} className="size-12 text-lg" />
          </InputOTPGroup>
        </InputOTP>
      </div>

      <div className="flex items-center justify-center text-sm">
        {isSubmitting ? (
          <span className="text-muted-foreground inline-flex items-center gap-2">
            <LoaderCircleIcon className="animate-spin size-4" />
            در حال تأیید…
          </span>
        ) : countdown > 0 ? (
          <span className="text-muted-foreground">
            ارسال مجدد کد در {toPersianDigits(String(countdown))} ثانیه
          </span>
        ) : (
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={handleResend}
            disabled={isResending}
          >
            {isResending ? 'در حال ارسال…' : 'ارسال مجدد کد'}
          </Button>
        )}
      </div>

      <div className="text-center">
        <Link href="/login" className="text-muted-foreground hover:text-foreground text-xs">
          تغییر شماره
        </Link>
      </div>
    </div>
  );
}

function VerifyPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phone = searchParams.get('phone') ?? '';
  const [validated, setValidated] = useState(false);

  useEffect(() => {
    if (!phone || !isValidIranianPhone(phone)) {
      router.replace('/login');
      return;
    }
    setValidated(true);
  }, [phone, router]);

  if (!validated) return null;
  return <VerifyForm phone={phone} />;
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyPageInner />
    </Suspense>
  );
}
