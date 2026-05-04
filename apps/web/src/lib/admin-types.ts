export type AdminUserStatus = 'PENDING_PROFILE' | 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export interface AdminRole {
  id: string;
  name: string;
  persianName: string;
  isSystem?: boolean;
}

export interface AdminUserListItem {
  id: string;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  nationalId: string | null;
  status: AdminUserStatus;
  createdAt: string;
  updatedAt: string;
  profileCompletedAt: string | null;
  deletedAt: string | null;
  roles: AdminRole[];
  lastSeenAt: string | null;
}

export interface PaginationMeta {
  pagination: {
    nextCursor?: string;
    limit: number;
  };
  hasMore: boolean;
}

export const USER_STATUS_LABELS: Record<AdminUserStatus, string> = {
  PENDING_PROFILE: 'در انتظار تکمیل پروفایل',
  ACTIVE: 'فعال',
  SUSPENDED: 'مسدود',
  DELETED: 'حذف‌شده',
};

export const USER_STATUS_VARIANT: Record<
  AdminUserStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  PENDING_PROFILE: 'secondary',
  ACTIVE: 'default',
  SUSPENDED: 'destructive',
  DELETED: 'outline',
};

export type PayoutStatus = 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED' | 'CANCELLED';

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  PENDING: 'در انتظار',
  APPROVED: 'تأیید شده',
  PAID: 'پرداخت شده',
  REJECTED: 'رد شده',
  CANCELLED: 'لغو شده',
};

export interface AdminPayout {
  id: string;
  userId: string;
  walletId: string;
  amount: string;
  status: PayoutStatus;
  bankAccount: string;
  accountHolder: string;
  submittedAt: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  paidAt: string | null;
  paymentReference: string | null;
}

export interface AdminPayoutPage {
  items: AdminPayout[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AuditActor {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
}

export interface AdminAuditLog {
  id: string;
  actorUserId: string | null;
  actor: AuditActor | null;
  action: string;
  resource: string;
  resourceId: string | null;
  payloadHash: string;
  failed: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}
