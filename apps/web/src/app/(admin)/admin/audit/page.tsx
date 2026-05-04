'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarIcon, LoaderCircleIcon } from 'lucide-react';
import { useState } from 'react';

import { JsonView } from '@/components/admin/json-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AdminAuditLog, PaginationMeta } from '@/lib/admin-types';
import apiClient, { type ApiSuccessEnvelope } from '@/lib/api-client';
import { formatJalaliFull } from '@/lib/dates';
import { cn } from '@/lib/utils';

const ACTION_OPTIONS: string[] = [
  'LOGIN_SUCCESS',
  'SIGNUP_SUCCESS',
  'AUTH_OTP_VERIFY',
  'SESSION_REFRESHED',
  'LOGOUT',
  'PROFILE_COMPLETED',
  'SESSION_REVOKED',
  'ADMIN_USER_UPDATE',
  'ADMIN_USER_STATUS_CHANGED',
  'ADMIN_ROLE_ASSIGNED',
  'ADMIN_ROLE_REMOVED',
  'IMPERSONATION_STARTED',
  'IMPERSONATION_ENDED',
  'PAYOUT_REQUESTED',
  'PAYOUT_CANCELLED',
  'PAYOUT_APPROVED',
  'PAYOUT_REJECTED',
  'PAYOUT_PAID',
  'PAYMENT_INITIATED',
  'PAYMENT_REFUND_REQUESTED',
];

const ANY_VALUE = '__any__';
const FAILED_ANY = '__any_state__';
const FAILED_TRUE = 'true';
const FAILED_FALSE = 'false';

interface AuditFilters {
  actions: string[];
  actorUserId?: string | undefined;
  resource?: string | undefined;
  failed?: 'true' | 'false' | undefined;
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
  cursor?: string | undefined;
}

function buildQuery(filters: AuditFilters): string {
  const params = new URLSearchParams();
  if (filters.actions.length > 0) params.set('action', filters.actions.join(','));
  if (filters.actorUserId) params.set('actorUserId', filters.actorUserId);
  if (filters.resource) params.set('resource', filters.resource);
  if (filters.failed) params.set('failed', filters.failed);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom.toISOString());
  if (filters.dateTo) params.set('dateTo', filters.dateTo.toISOString());
  if (filters.cursor) params.set('cursor', filters.cursor);
  params.set('limit', '50');
  return params.toString();
}

function actorLabel(row: AdminAuditLog): string {
  if (!row.actor) return row.actorUserId ? `#${row.actorUserId}` : 'سیستم';
  const name = `${row.actor.firstName ?? ''} ${row.actor.lastName ?? ''}`.trim();
  return name ? `${name} (${row.actor.phone})` : row.actor.phone;
}

function DatePickerField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Date | undefined;
  onChange: (d: Date | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className={cn('w-44 justify-start gap-2 font-normal')}>
            <CalendarIcon className="size-4" />
            {value ? formatJalaliFull(value).split(' ')[0] : 'انتخاب تاریخ'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(d) => {
              onChange(d ?? undefined);
              setOpen(false);
            }}
          />
          {value && (
            <div className="border-t p-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  onChange(undefined);
                  setOpen(false);
                }}
              >
                پاک کردن
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default function AdminAuditPage() {
  const [filters, setFilters] = useState<AuditFilters>({ actions: [] });
  const [actorDraft, setActorDraft] = useState('');
  const [resourceDraft, setResourceDraft] = useState('');
  const [selectedRow, setSelectedRow] = useState<AdminAuditLog | null>(null);

  const queryString = buildQuery(filters);
  const auditQuery = useQuery<ApiSuccessEnvelope<AdminAuditLog[]>>({
    queryKey: ['admin', 'audit', queryString],
    queryFn: () => apiClient.get<AdminAuditLog[]>(`/admin/audit?${queryString}`),
  });

  const meta = auditQuery.data?.meta as PaginationMeta | undefined;
  const items = auditQuery.data?.data ?? [];

  function patchFilters(patch: Partial<AuditFilters>) {
    setFilters((prev) => {
      const { cursor: _cursor, ...rest } = prev;
      return { ...rest, ...patch };
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">گزارش حسابرسی</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          همه عملیات‌ ممیزی‌شده — برای جزئیات روی یک ردیف کلیک کنید.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-action">کنش</Label>
          <Select
            value={filters.actions[0] ?? ANY_VALUE}
            onValueChange={(v) => patchFilters({ actions: v === ANY_VALUE ? [] : [v] })}
          >
            <SelectTrigger id="filter-action" className="w-56">
              <SelectValue placeholder="همه" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_VALUE}>همه</SelectItem>
              {ACTION_OPTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            patchFilters({
              actorUserId: actorDraft.trim() || undefined,
              resource: resourceDraft.trim() || undefined,
            });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-actor">شناسه عامل</Label>
            <Input
              id="filter-actor"
              value={actorDraft}
              onChange={(e) => setActorDraft(e.target.value)}
              placeholder="مثلاً 42"
              className="w-32"
              dir="ltr"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="filter-resource">منبع</Label>
            <Input
              id="filter-resource"
              value={resourceDraft}
              onChange={(e) => setResourceDraft(e.target.value)}
              placeholder="user, payout, …"
              className="w-36"
              dir="ltr"
            />
          </div>
          <Button type="submit" variant="outline">
            اعمال
          </Button>
        </form>

        <DatePickerField
          label="از تاریخ"
          value={filters.dateFrom}
          onChange={(d) => patchFilters({ dateFrom: d })}
        />
        <DatePickerField
          label="تا تاریخ"
          value={filters.dateTo}
          onChange={(d) => patchFilters({ dateTo: d })}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-failed">وضعیت</Label>
          <Select
            value={filters.failed ?? FAILED_ANY}
            onValueChange={(v) =>
              patchFilters({ failed: v === FAILED_ANY ? undefined : (v as 'true' | 'false') })
            }
          >
            <SelectTrigger id="filter-failed" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={FAILED_ANY}>همه</SelectItem>
              <SelectItem value={FAILED_FALSE}>موفق</SelectItem>
              <SelectItem value={FAILED_TRUE}>ناموفق</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>زمان</TableHead>
              <TableHead>عامل</TableHead>
              <TableHead>کنش</TableHead>
              <TableHead>منبع</TableHead>
              <TableHead>وضعیت</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {auditQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-8 text-center">
                  <LoaderCircleIcon className="mx-auto size-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-8 text-center">
                  ردیفی یافت نشد
                </TableCell>
              </TableRow>
            ) : (
              items.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedRow(row)}
                >
                  <TableCell className="text-xs">{formatJalaliFull(row.createdAt)}</TableCell>
                  <TableCell className="text-sm">{actorLabel(row)}</TableCell>
                  <TableCell className="font-mono text-xs">{row.action}</TableCell>
                  <TableCell className="text-sm">
                    {row.resource}
                    {row.resourceId ? ` #${row.resourceId}` : ''}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.failed ? 'destructive' : 'default'}>
                      {row.failed ? 'ناموفق' : 'موفق'}
                    </Badge>
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

      <Sheet open={selectedRow !== null} onOpenChange={(open) => !open && setSelectedRow(null)}>
        <SheetContent side="left" className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>جزئیات رویداد</SheetTitle>
            <SheetDescription>
              {selectedRow ? (
                <>
                  {selectedRow.action} روی {selectedRow.resource}
                </>
              ) : null}
            </SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto px-4 pb-4">
            {selectedRow && <JsonView value={selectedRow} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
