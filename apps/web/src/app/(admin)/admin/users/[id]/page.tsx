'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircleIcon, Trash2Icon, UserCogIcon } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';

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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { usePermission } from '@/hooks/use-permission';
import { adminMutate } from '@/lib/admin-mutate';
import {
  USER_STATUS_LABELS,
  USER_STATUS_VARIANT,
  type AdminRole,
  type AdminUserListItem,
  type AdminUserStatus,
} from '@/lib/admin-types';
import apiClient, { ApiError } from '@/lib/api-client';
import { formatJalaliFull } from '@/lib/dates';
import { useAuthStore, type User } from '@/store/auth.store';

const STATUS_OPTIONS: AdminUserStatus[] = ['ACTIVE', 'SUSPENDED', 'DELETED'];

interface ImpersonationStartResponse {
  impSessionId: string;
  accessToken: string;
  targetUserId: string;
}

function fullName(user: AdminUserListItem | undefined): string {
  if (!user) return '';
  const first = user.firstName ?? '';
  const last = user.lastName ?? '';
  return `${first} ${last}`.trim() || '—';
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 items-center gap-3 border-b py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="col-span-2">{value}</span>
    </div>
  );
}

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const userId = params.id;

  const userQuery = useQuery<AdminUserListItem>({
    queryKey: ['admin', 'user', userId],
    queryFn: async () => {
      const res = await apiClient.get<AdminUserListItem>(`/admin/users/${userId}`);
      return res.data;
    },
    enabled: Boolean(userId),
  });

  const rolesQuery = useQuery<AdminRole[]>({
    queryKey: ['admin', 'roles'],
    queryFn: async () => {
      const res = await apiClient.get<AdminRole[]>('/admin/roles');
      return res.data;
    },
  });

  const canImpersonate = usePermission('admin:impersonate:user');

  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusDraft, setStatusDraft] = useState<AdminUserStatus | undefined>();

  const [addRoleOpen, setAddRoleOpen] = useState(false);
  const [roleDraft, setRoleDraft] = useState<string | undefined>();

  const [removeRoleId, setRemoveRoleId] = useState<string | null>(null);

  const [impersonationOpen, setImpersonationOpen] = useState(false);
  const [impersonationReason, setImpersonationReason] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'user', userId] });

  const statusMutation = useMutation({
    mutationFn: async (newStatus: AdminUserStatus) => {
      await apiClient.patch(`/admin/users/${userId}`, { status: newStatus });
    },
    onSuccess: () => {
      toast.success('وضعیت کاربر به‌روزرسانی شد');
      setStatusDialogOpen(false);
      setStatusDraft(undefined);
      void invalidate();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'خطا در تغییر وضعیت');
    },
  });

  const addRoleMutation = useMutation({
    mutationFn: async (roleId: string) => {
      await apiClient.post(`/admin/users/${userId}/roles`, { roleId });
    },
    onSuccess: () => {
      toast.success('نقش به کاربر افزوده شد');
      setAddRoleOpen(false);
      setRoleDraft(undefined);
      void invalidate();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'خطا در افزودن نقش');
    },
  });

  const removeRoleMutation = useMutation({
    mutationFn: async (roleId: string) => {
      await apiClient.delete(`/admin/users/${userId}/roles/${roleId}`);
    },
    onSuccess: () => {
      toast.success('نقش حذف شد');
      setRemoveRoleId(null);
      void invalidate();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'خطا در حذف نقش');
    },
  });

  const impersonationMutation = useMutation({
    mutationFn: async (reason: string) => {
      const res = await adminMutate<ImpersonationStartResponse>(
        'POST',
        '/admin/impersonation/start',
        { targetUserId: userId, reason },
        { idempotencyKey: uuidv4() },
      );
      return res.data;
    },
    onSuccess: async (data) => {
      try {
        // Replace token; bootstrap-style: hydrate the new user via /users/me.
        useAuthStore.setState({ accessToken: data.accessToken });
        const me = await apiClient.get<User>('/users/me');
        useAuthStore.getState().setAuth(data.accessToken, me.data);
        setImpersonationOpen(false);
        setImpersonationReason('');
        toast.success('وارد حساب کاربر شدید — برای خروج از منوی کاربر استفاده کنید');
        router.push('/dashboard');
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'خطا در راه‌اندازی شبیه‌سازی');
      }
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : 'خطا در شروع شبیه‌سازی');
    },
  });

  if (userQuery.isLoading) {
    return (
      <div className="flex justify-center p-12">
        <LoaderCircleIcon className="size-6 animate-spin" />
      </div>
    );
  }

  if (userQuery.isError || !userQuery.data) {
    return <p className="text-destructive p-6">کاربر یافت نشد.</p>;
  }

  const user = userQuery.data;
  const reasonValid = impersonationReason.trim().length >= 10;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{fullName(user)}</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">{user.phone}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setStatusDraft(user.status);
              setStatusDialogOpen(true);
            }}
          >
            تغییر وضعیت
          </Button>
          <Button variant="outline" onClick={() => setAddRoleOpen(true)}>
            افزودن نقش
          </Button>
          {canImpersonate && (
            <Button variant="default" onClick={() => setImpersonationOpen(true)}>
              <UserCogIcon className="size-4" />
              شبیه‌سازی
            </Button>
          )}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">اطلاعات کاربر</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldRow label="شناسه" value={<span className="font-mono">{user.id}</span>} />
          <FieldRow label="تلفن" value={<span className="font-mono">{user.phone}</span>} />
          <FieldRow label="نام" value={user.firstName ?? '—'} />
          <FieldRow label="نام خانوادگی" value={user.lastName ?? '—'} />
          <FieldRow label="ایمیل" value={user.email ?? '—'} />
          <FieldRow
            label="کد ملی"
            value={user.nationalId ? <span className="font-mono">{user.nationalId}</span> : '—'}
          />
          <FieldRow
            label="وضعیت"
            value={
              <Badge variant={USER_STATUS_VARIANT[user.status]}>
                {USER_STATUS_LABELS[user.status]}
              </Badge>
            }
          />
          <FieldRow label="تاریخ ایجاد" value={formatJalaliFull(user.createdAt)} />
          <FieldRow
            label="تکمیل پروفایل"
            value={user.profileCompletedAt ? formatJalaliFull(user.profileCompletedAt) : '—'}
          />
          <FieldRow
            label="آخرین فعالیت"
            value={user.lastSeenAt ? formatJalaliFull(user.lastSeenAt) : '—'}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">نقش‌ها</CardTitle>
        </CardHeader>
        <CardContent>
          {user.roles.length === 0 ? (
            <p className="text-muted-foreground text-sm">نقشی به این کاربر اختصاص داده نشده است.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {user.roles.map((role) => (
                <li key={role.id}>
                  <span className="bg-muted inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm">
                    {role.persianName}
                    <button
                      type="button"
                      className="text-destructive hover:text-destructive/80 transition"
                      onClick={() => setRemoveRoleId(role.id)}
                      aria-label={`حذف نقش ${role.persianName}`}
                    >
                      <Trash2Icon className="size-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Status dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تغییر وضعیت کاربر</DialogTitle>
            <DialogDescription>وضعیت جدید را انتخاب کنید.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Label htmlFor="status-select">وضعیت</Label>
            <Select
              value={statusDraft ?? ''}
              onValueChange={(v) => setStatusDraft(v as AdminUserStatus)}
            >
              <SelectTrigger id="status-select" className="w-full">
                <SelectValue placeholder="انتخاب کنید" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {USER_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>
              انصراف
            </Button>
            <Button
              disabled={!statusDraft || statusDraft === user.status || statusMutation.isPending}
              onClick={() => statusDraft && statusMutation.mutate(statusDraft)}
            >
              ذخیره
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add role dialog */}
      <Dialog open={addRoleOpen} onOpenChange={setAddRoleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>افزودن نقش</DialogTitle>
            <DialogDescription>نقشی را برای اختصاص به این کاربر انتخاب کنید.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Label htmlFor="role-select">نقش</Label>
            <Select value={roleDraft ?? ''} onValueChange={(v) => setRoleDraft(v)}>
              <SelectTrigger id="role-select" className="w-full">
                <SelectValue placeholder="انتخاب کنید" />
              </SelectTrigger>
              <SelectContent>
                {rolesQuery.data
                  ?.filter((r) => !user.roles.some((ur) => ur.id === r.id))
                  .map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.persianName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddRoleOpen(false)}>
              انصراف
            </Button>
            <Button
              disabled={!roleDraft || addRoleMutation.isPending}
              onClick={() => roleDraft && addRoleMutation.mutate(roleDraft)}
            >
              افزودن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove role confirm */}
      <AlertDialog
        open={removeRoleId !== null}
        onOpenChange={(open) => !open && setRemoveRoleId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف نقش</AlertDialogTitle>
            <AlertDialogDescription>
              آیا از حذف این نقش از کاربر مطمئن هستید؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeRoleId && removeRoleMutation.mutate(removeRoleId)}
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Impersonation dialog */}
      {canImpersonate && (
        <Dialog open={impersonationOpen} onOpenChange={setImpersonationOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>شبیه‌سازی کاربر</DialogTitle>
              <DialogDescription>
                دلیل شبیه‌سازی را برای ثبت در گزارش حسابرسی وارد کنید (حداقل ۱۰ کاراکتر).
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="imp-reason">دلیل</Label>
              <Textarea
                id="imp-reason"
                value={impersonationReason}
                onChange={(e) => setImpersonationReason(e.target.value)}
                rows={4}
                placeholder="مثلاً: بررسی مشکل پرداخت گزارش‌شده توسط کاربر"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setImpersonationOpen(false)}>
                انصراف
              </Button>
              <Button
                disabled={!reasonValid || impersonationMutation.isPending}
                onClick={() => impersonationMutation.mutate(impersonationReason.trim())}
              >
                شروع شبیه‌سازی
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
