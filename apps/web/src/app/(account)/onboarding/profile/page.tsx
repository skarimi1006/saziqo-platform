'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { toLatinDigits } from '@saziqo/persian-utils';
import { LoaderCircleIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import apiClient, { ApiError } from '@/lib/api-client';
import { generateIdempotencyKey } from '@/lib/idempotency';
import { profileSchema, type ProfileFormValues } from '@/lib/schemas/profile.schema';
import { useAuthStore } from '@/store/auth.store';

interface ApiFieldError {
  path?: string[];
  message?: string;
}

interface ConflictDetails {
  target?: string | string[];
}

const FIELD_LABELS: Record<keyof ProfileFormValues, string> = {
  firstName: 'نام',
  lastName: 'نام خانوادگی',
  nationalId: 'کد ملی',
  email: 'ایمیل',
};

const CONFLICT_MESSAGES: Partial<Record<keyof ProfileFormValues, string>> = {
  nationalId: 'این کد ملی قبلاً ثبت شده است',
  email: 'این ایمیل قبلاً ثبت شده است',
};

function fieldFromConflictTarget(
  target: string | string[] | undefined,
): keyof ProfileFormValues | null {
  if (!target) return null;
  const targets = Array.isArray(target) ? target : [target];
  for (const t of targets) {
    if (t === 'nationalId' || t === 'email' || t === 'firstName' || t === 'lastName') {
      return t;
    }
  }
  return null;
}

export default function CompleteProfilePage() {
  const router = useRouter();
  const { user, profileComplete } = useAuth();

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { firstName: '', lastName: '', nationalId: '', email: '' },
  });

  useEffect(() => {
    if (profileComplete) router.replace('/dashboard');
  }, [profileComplete, router]);

  // SECURITY: nationalId is digits-only; convert Persian → Latin on input so
  // the user can type either way and Zod still sees ASCII digits.
  function handleNationalIdChange(e: React.ChangeEvent<HTMLInputElement>) {
    const latin = toLatinDigits(e.target.value);
    setValue('nationalId', latin, { shouldValidate: true });
  }

  async function onSubmit(values: ProfileFormValues) {
    try {
      await apiClient.post('/users/me/complete-profile', values, {
        idempotencyKey: generateIdempotencyKey(),
      });
      await useAuthStore.getState().refreshUser();
      toast.success('پروفایل شما تکمیل شد. خوش آمدید!');
      router.replace('/dashboard');
    } catch (err) {
      if (!(err instanceof ApiError)) {
        toast.error('خطا در ذخیره پروفایل');
        return;
      }

      if (err.code === 'CONFLICT') {
        const field = fieldFromConflictTarget((err.details as ConflictDetails)?.target);
        if (field) {
          setError(field, {
            type: 'server',
            message: CONFLICT_MESSAGES[field] ?? `${FIELD_LABELS[field]} تکراری است`,
          });
          return;
        }
        toast.error('این اطلاعات قبلاً ثبت شده است');
        return;
      }

      if (err.code === 'VALIDATION_ERROR') {
        const fields = (err.details as { fields?: ApiFieldError[] } | undefined)?.fields ?? [];
        let mapped = false;
        for (const f of fields) {
          const name = f.path?.[0];
          if (
            name === 'firstName' ||
            name === 'lastName' ||
            name === 'nationalId' ||
            name === 'email'
          ) {
            setError(name, { type: 'server', message: f.message ?? 'مقدار نامعتبر' });
            mapped = true;
          }
        }
        if (!mapped) toast.error(err.message || 'مقادیر نامعتبر');
        return;
      }

      toast.error(err.message || 'خطا در ذخیره پروفایل');
    }
  }

  if (!user) return null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold text-foreground">تکمیل پروفایل</h1>
        <p className="text-muted-foreground text-sm">
          برای استفاده از سازیکو، اطلاعات زیر را تکمیل کنید.
        </p>
      </header>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="firstName">نام</Label>
            <Input
              id="firstName"
              autoComplete="given-name"
              aria-invalid={errors.firstName ? true : undefined}
              {...register('firstName')}
            />
            {errors.firstName && (
              <p className="text-destructive text-xs">{errors.firstName.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="lastName">نام خانوادگی</Label>
            <Input
              id="lastName"
              autoComplete="family-name"
              aria-invalid={errors.lastName ? true : undefined}
              {...register('lastName')}
            />
            {errors.lastName && (
              <p className="text-destructive text-xs">{errors.lastName.message}</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="nationalId">کد ملی</Label>
          <Input
            id="nationalId"
            type="text"
            dir="ltr"
            inputMode="numeric"
            maxLength={10}
            placeholder="0123456789"
            autoComplete="off"
            aria-invalid={errors.nationalId ? true : undefined}
            {...register('nationalId', { onChange: handleNationalIdChange })}
          />
          {errors.nationalId && (
            <p className="text-destructive text-xs">{errors.nationalId.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="email">ایمیل</Label>
          <Input
            id="email"
            type="email"
            dir="ltr"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={errors.email ? true : undefined}
            {...register('email')}
          />
          {errors.email && <p className="text-destructive text-xs">{errors.email.message}</p>}
        </div>

        <Button type="submit" className="w-full sm:w-auto sm:self-start" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <LoaderCircleIcon className="animate-spin" />
              در حال ذخیره…
            </>
          ) : (
            'ذخیره و ادامه'
          )}
        </Button>
      </form>
    </div>
  );
}
