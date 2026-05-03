'use client';

// CLAUDE: Client-side sandbox for the shadcn primitives. Renders every
// installed component with Persian copy so a human can eyeball RTL
// correctness in dev. No tests rely on this page; it's purely a visual
// aid. Add new primitives here as they're installed.

import { Save, Settings, User as UserIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';


import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Toaster } from '@/components/ui/sonner';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import apiClient, { ApiError } from '@/lib/api-client';

type HealthState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'ok'; payload: unknown }
  | { status: 'error'; message: string };

export function ComponentSandboxClient() {
  const [switchOn, setSwitchOn] = useState(false);
  const [health, setHealth] = useState<HealthState>({ status: 'idle' });

  useEffect(() => {
    let cancelled = false;
    setHealth({ status: 'pending' });
    apiClient
      .get<unknown>('/health', { skipAuth: true })
      .then((res) => {
        if (cancelled) return;
        setHealth({ status: 'ok', payload: res.data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof ApiError
            ? `${err.status} ${err.code}: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err);
        setHealth({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="container mx-auto max-w-4xl space-y-12 p-8">
      <header>
        <h1 className="text-3xl font-bold">جعبه‌ابزار اجزای رابط</h1>
        <p className="text-muted-foreground mt-2">
          صفحه‌ی فقط-توسعه برای بررسی چشمی رفتار راست‌به‌چپ هر کامپوننت shadcn.
        </p>
      </header>

      <section data-testid="health-check" className="rounded-lg border p-4" dir="ltr">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          API health
        </h2>
        {health.status === 'idle' && <p className="mt-2 text-sm">idle</p>}
        {health.status === 'pending' && (
          <p className="mt-2 text-sm" data-state="pending">
            calling GET /api/v1/health …
          </p>
        )}
        {health.status === 'ok' && (
          <p className="mt-2 text-sm text-green-600" data-state="ok">
            ok — {JSON.stringify(health.payload)}
          </p>
        )}
        {health.status === 'error' && (
          <p className="mt-2 text-sm text-red-600" data-state="error">
            error — {health.message}
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">دکمه</h2>
        <div className="flex flex-wrap gap-3">
          <Button>پیش‌فرض</Button>
          <Button variant="secondary">دکمه ثانویه</Button>
          <Button variant="outline">حاشیه‌دار</Button>
          <Button variant="ghost">شفاف</Button>
          <Button variant="destructive">حذف</Button>
          <Button>
            <Save />
            ذخیره
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">ورودی متن</h2>
        <div className="grid max-w-sm gap-2">
          <Label htmlFor="full-name">نام و نام خانوادگی</Label>
          <Input id="full-name" placeholder="مثلاً علی محمدی" />
        </div>
        <div className="grid max-w-sm gap-2">
          <Label htmlFor="phone">شماره موبایل</Label>
          {/* dir="ltr" is intentional for digit-only inputs; see input.tsx CLAUDE note */}
          <Input id="phone" dir="ltr" placeholder="+98912XXXXXXX" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">کارت</h2>
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>عنوان کارت</CardTitle>
            <CardDescription>توضیح کوتاه از محتوای کارت در یک خط.</CardDescription>
          </CardHeader>
          <CardContent>
            <p>هر متنی که داخل کارت قرار گیرد به صورت راست‌به‌چپ نمایش داده می‌شود.</p>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">انتخاب‌گر</h2>
        <Select>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="یک گزینه انتخاب کنید" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>میوه‌ها</SelectLabel>
              <SelectItem value="apple">سیب</SelectItem>
              <SelectItem value="banana">موز</SelectItem>
              <SelectItem value="cherry">گیلاس</SelectItem>
              <SelectItem value="orange">پرتقال</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">منوی کشویی</h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Settings />
              تنظیمات
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>حساب کاربری</DropdownMenuLabel>
            <DropdownMenuItem>
              <UserIcon />
              پروفایل
              <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>تنظیمات</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>تیم‌ها</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>تیم بازاریابی</DropdownMenuItem>
                <DropdownMenuItem>تیم محصول</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">خروج</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">دیالوگ</h2>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">باز کردن دیالوگ</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>تأیید عملیات</DialogTitle>
              <DialogDescription>
                آیا از انجام این عمل مطمئن هستید؟ این عملیات قابل بازگشت نیست.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline">انصراف</Button>
              <Button>تأیید</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">شیت (کشوی کناری)</h2>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">باز کردن شیت (راست)</Button>
          </SheetTrigger>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>تنظیمات سریع</SheetTitle>
              <SheetDescription>
                این کشو از سمت راست بصری باز می‌شود — بدون توجه به جهت متن صفحه.
              </SheetDescription>
            </SheetHeader>
            <SheetFooter>
              <Button>ذخیره تغییرات</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">سوییچ</h2>
        <div className="flex items-center gap-3">
          <Switch id="notify" checked={switchOn} onCheckedChange={setSwitchOn} />
          <Label htmlFor="notify">اعلان‌ها فعال باشند</Label>
        </div>
        <p className="text-muted-foreground text-sm">
          وضعیت فعلی: {switchOn ? 'روشن' : 'خاموش'} — وقتی خاموش است، شست باید روی سمت راست بصری
          دیده شود.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">راهنمای ابزار</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline">حرکت موس روی این دکمه</Button>
          </TooltipTrigger>
          <TooltipContent>این یک پیام راهنماست</TooltipContent>
        </Tooltip>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">پیام شناور (Toast)</h2>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => toast.success('با موفقیت ذخیره شد')}>پیام موفقیت</Button>
          <Button variant="destructive" onClick={() => toast.error('خطا در ارسال درخواست')}>
            پیام خطا
          </Button>
          <Button
            variant="outline"
            onClick={() => toast('یک پیام معمولی', { description: 'با توضیح اضافه' })}
          >
            پیام معمولی
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">
          پیام‌ها باید در گوشه‌ی بالا-چپ صفحه ظاهر شوند.
        </p>
      </section>

      <Toaster />
    </main>
  );
}
