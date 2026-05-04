'use client';

import { toPersianDigits } from '@saziqo/persian-utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircleIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { adminMutate } from '@/lib/admin-mutate';
import {
  PAYOUT_STATUS_LABELS,
  type AdminPayout,
  type AdminPayoutPage,
  type PayoutStatus,
} from '@/lib/admin-types';
import apiClient, { ApiError } from '@/lib/api-client';
import { formatJalaliFull } from '@/lib/dates';

const TABS: PayoutStatus[] = ['PENDING', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED'];

function formatToman(raw: string): string {
  const n = BigInt(raw);
  const formatted = n.toLocaleString('en-US');
  return `${toPersianDigits(formatted)} تومان`;
}

function PayoutsTable({ status }: { status: PayoutStatus }) {
  const queryClient = useQueryClient();
  const queryKey = ['admin', 'payouts', status];

  const payoutsQuery = useQuery<AdminPayoutPage>({
    queryKey,
    queryFn: async () => {
      const res = await apiClient.get<AdminPayoutPage>(`/admin/payouts?status=${status}&limit=20`);
      return res.data;
    },
  });

  const items = payoutsQuery.data?.items ?? [];

  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingPayout, setRejectingPayout] = useState<AdminPayout | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [markPaidPayout, setMarkPaidPayout] = useState<AdminPayout | null>(null);
  const [paymentReference, setPaymentReference] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'payouts'] });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      await adminMutate('PATCH', `/admin/payouts/${id}/approve`);
    },
    onSuccess: () => {
      toast.success('درخواست تسویه تأیید شد');
      setApprovingId(null);
      void invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'خطا در تأیید'),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      await adminMutate('PATCH', `/admin/payouts/${id}/reject`, { reason });
    },
    onSuccess: () => {
      toast.success('درخواست تسویه رد شد');
      setRejectingPayout(null);
      setRejectReason('');
      void invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'خطا در رد درخواست'),
  });

  const markPaidMutation = useMutation({
    mutationFn: async ({ id, ref }: { id: string; ref: string }) => {
      await adminMutate('PATCH', `/admin/payouts/${id}/mark-paid`, { paymentReference: ref });
    },
    onSuccess: () => {
      toast.success('پرداخت ثبت شد');
      setMarkPaidPayout(null);
      setPaymentReference('');
      void invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'خطا در ثبت پرداخت'),
  });

  return (
    <>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>شناسه</TableHead>
              <TableHead>کاربر</TableHead>
              <TableHead>مبلغ</TableHead>
              <TableHead>صاحب حساب</TableHead>
              <TableHead>شبا</TableHead>
              <TableHead>تاریخ ثبت</TableHead>
              <TableHead className="text-end">عملیات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payoutsQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                  <LoaderCircleIcon className="mx-auto size-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                  درخواستی در این وضعیت وجود ندارد
                </TableCell>
              </TableRow>
            ) : (
              items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.id}</TableCell>
                  <TableCell className="font-mono text-xs">#{p.userId}</TableCell>
                  <TableCell className="text-sm">{formatToman(p.amount)}</TableCell>
                  <TableCell className="text-sm">{p.accountHolder}</TableCell>
                  <TableCell className="font-mono text-xs">{p.bankAccount}</TableCell>
                  <TableCell className="text-xs">{formatJalaliFull(p.submittedAt)}</TableCell>
                  <TableCell className="text-end">
                    {status === 'PENDING' && (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => setApprovingId(p.id)}>
                          تأیید
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setRejectingPayout(p)}
                        >
                          رد
                        </Button>
                      </div>
                    )}
                    {status === 'APPROVED' && (
                      <Button size="sm" onClick={() => setMarkPaidPayout(p)}>
                        ثبت پرداخت
                      </Button>
                    )}
                    {(status === 'PAID' || status === 'REJECTED' || status === 'CANCELLED') && (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={approvingId !== null} onOpenChange={(o) => !o && setApprovingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأیید درخواست تسویه</AlertDialogTitle>
            <AlertDialogDescription>
              با تأیید این درخواست، مبلغ از کیف پول کاربر کسر شده و در انتظار پرداخت قرار می‌گیرد.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction onClick={() => approvingId && approveMutation.mutate(approvingId)}>
              تأیید
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={rejectingPayout !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRejectingPayout(null);
            setRejectReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>رد درخواست تسویه</DialogTitle>
            <DialogDescription>
              دلیل رد را وارد کنید (به کاربر نمایش داده می‌شود).
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reject-reason">دلیل</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingPayout(null)}>
              انصراف
            </Button>
            <Button
              variant="destructive"
              disabled={rejectReason.trim().length < 1 || rejectMutation.isPending}
              onClick={() =>
                rejectingPayout &&
                rejectMutation.mutate({ id: rejectingPayout.id, reason: rejectReason.trim() })
              }
            >
              رد درخواست
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={markPaidPayout !== null}
        onOpenChange={(o) => {
          if (!o) {
            setMarkPaidPayout(null);
            setPaymentReference('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ثبت پرداخت</DialogTitle>
            <DialogDescription>کد پیگیری بانکی را وارد کنید.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="payment-ref">کد پیگیری</Label>
            <Input
              id="payment-ref"
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              dir="ltr"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkPaidPayout(null)}>
              انصراف
            </Button>
            <Button
              disabled={paymentReference.trim().length < 1 || markPaidMutation.isPending}
              onClick={() =>
                markPaidPayout &&
                markPaidMutation.mutate({
                  id: markPaidPayout.id,
                  ref: paymentReference.trim(),
                })
              }
            >
              ثبت
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AdminPayoutsPage() {
  const [active, setActive] = useState<PayoutStatus>('PENDING');
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">صف تسویه</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          مدیریت درخواست‌های تسویه — تأیید، رد و ثبت پرداخت بانکی.
        </p>
      </header>

      <Tabs value={active} onValueChange={(v) => setActive(v as PayoutStatus)}>
        <TabsList>
          {TABS.map((s) => (
            <TabsTrigger key={s} value={s}>
              {PAYOUT_STATUS_LABELS[s]}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((s) => (
          <TabsContent key={s} value={s} className="mt-4">
            {active === s && <PayoutsTable status={s} />}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
