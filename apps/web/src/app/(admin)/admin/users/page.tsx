'use client';

import { useQuery } from '@tanstack/react-query';
import { LoaderCircleIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  USER_STATUS_LABELS,
  USER_STATUS_VARIANT,
  type AdminRole,
  type AdminUserListItem,
  type AdminUserStatus,
  type PaginationMeta,
} from '@/lib/admin-types';
import apiClient, { type ApiSuccessEnvelope } from '@/lib/api-client';
import { formatJalaliFull } from '@/lib/dates';

interface UsersFilters {
  status?: AdminUserStatus | undefined;
  roleId?: string | undefined;
  search?: string | undefined;
  cursor?: string | undefined;
}

const STATUS_OPTIONS: AdminUserStatus[] = ['PENDING_PROFILE', 'ACTIVE', 'SUSPENDED', 'DELETED'];

const ANY_VALUE = '__any__';

function buildQueryString(filters: UsersFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.roleId) params.set('roleId', filters.roleId);
  if (filters.search) params.set('search', filters.search);
  if (filters.cursor) params.set('cursor', filters.cursor);
  params.set('limit', '20');
  return params.toString();
}

function fullName(user: AdminUserListItem): string {
  const first = user.firstName ?? '';
  const last = user.lastName ?? '';
  const combined = `${first} ${last}`.trim();
  return combined || '—';
}

export default function AdminUsersPage() {
  const [filters, setFilters] = useState<UsersFilters>({});
  const [searchDraft, setSearchDraft] = useState('');

  const { data: rolesData } = useQuery<AdminRole[]>({
    queryKey: ['admin', 'roles'],
    queryFn: async () => {
      const res = await apiClient.get<AdminRole[]>('/admin/roles');
      return res.data;
    },
  });

  const queryString = buildQueryString(filters);
  const usersQuery = useQuery<ApiSuccessEnvelope<AdminUserListItem[]>>({
    queryKey: ['admin', 'users', queryString],
    queryFn: () => apiClient.get<AdminUserListItem[]>(`/admin/users?${queryString}`),
  });

  const meta = usersQuery.data?.meta as PaginationMeta | undefined;
  const items = usersQuery.data?.data ?? [];

  function applyFilter(patch: Partial<UsersFilters>) {
    setFilters((prev) => {
      const { cursor: _cursor, ...rest } = prev;
      return { ...rest, ...patch };
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">کاربران</h1>
        <p className="text-muted-foreground mt-1 text-sm">مدیریت کاربران ثبت‌شده در پلتفرم</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-status">وضعیت</Label>
          <Select
            value={filters.status ?? ANY_VALUE}
            onValueChange={(value) =>
              applyFilter({ status: value === ANY_VALUE ? undefined : (value as AdminUserStatus) })
            }
          >
            <SelectTrigger id="filter-status" className="w-44">
              <SelectValue placeholder="همه" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_VALUE}>همه</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {USER_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-role">نقش</Label>
          <Select
            value={filters.roleId ?? ANY_VALUE}
            onValueChange={(value) =>
              applyFilter({ roleId: value === ANY_VALUE ? undefined : value })
            }
          >
            <SelectTrigger id="filter-role" className="w-44">
              <SelectValue placeholder="همه" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_VALUE}>همه</SelectItem>
              {rolesData?.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.persianName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            applyFilter({ search: searchDraft.trim() || undefined });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-search">جستجو (نام/ایمیل)</Label>
            <Input
              id="filter-search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="حداقل ۲ کاراکتر"
              className="w-64"
            />
          </div>
          <Button type="submit" variant="outline">
            اعمال
          </Button>
        </form>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>شناسه</TableHead>
              <TableHead>تلفن</TableHead>
              <TableHead>نام</TableHead>
              <TableHead>ایمیل</TableHead>
              <TableHead>وضعیت</TableHead>
              <TableHead>تاریخ ایجاد</TableHead>
              <TableHead className="text-end">عملیات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usersQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                  <LoaderCircleIcon className="mx-auto size-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                  کاربری یافت نشد
                </TableCell>
              </TableRow>
            ) : (
              items.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-mono text-xs">{user.id}</TableCell>
                  <TableCell className="font-mono text-xs">{user.phone}</TableCell>
                  <TableCell>{fullName(user)}</TableCell>
                  <TableCell className="text-sm">{user.email ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={USER_STATUS_VARIANT[user.status]}>
                      {USER_STATUS_LABELS[user.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{formatJalaliFull(user.createdAt)}</TableCell>
                  <TableCell className="text-end">
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/admin/users/${user.id}`}>مشاهده</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          {items.length > 0 ? `${items.length} ردیف` : ''}
        </p>
        <Button
          variant="outline"
          disabled={!meta?.hasMore || !meta?.pagination.nextCursor}
          onClick={() => {
            if (meta?.pagination.nextCursor) {
              setFilters((prev) => ({ ...prev, cursor: meta.pagination.nextCursor }));
            }
          }}
        >
          بعدی
        </Button>
      </div>
    </div>
  );
}
