import type {
  AdminPageDefinition,
  NotificationTypeDefinition,
  PermissionDefinition,
} from '../../core/module-registry/types';

// CLAUDE: Agents-marketplace module contract — registry-merged at boot by
// core/module-registry/module-loader.service.ts. Every entry below is
// idempotent on re-boot: permissions upsert by code, notification types
// override on collision, admin pages are sorted into the global list,
// payment purposes feed into the PaymentsService allow-list. Edits here
// must stay in lockstep with plan/agents-module-plan.md (master skeleton).

// ─── Permissions ────────────────────────────────────────────────────────
// 14 entries per master plan §"registerPermissions()". Default roles
// follow the master plan:
//   buyer-facing (6) + maker-facing (3) → 'user'
//   admin-facing (5)                    → 'admin'
// super_admin always passes via the super:everything bypass and is not
// listed as a defaultRole anywhere.
export const AGENTS_PERMISSIONS: readonly PermissionDefinition[] = [
  // Buyer-facing
  {
    code: 'agents:read:catalog',
    description: 'Browse the agents catalog',
    persianDescription: 'مرور بازارگاه ایجنت‌ها',
    defaultRoles: ['user'],
  },
  {
    code: 'agents:read:listing',
    description: 'View a listing detail page',
    persianDescription: 'دیدن صفحه جزئیات لیستینگ',
    defaultRoles: ['user'],
  },
  {
    code: 'agents:purchase:listing',
    description: 'Buy or install a listing',
    persianDescription: 'خرید یا نصب لیستینگ',
    defaultRoles: ['user'],
  },
  {
    code: 'agents:download:owned',
    description: 'Download files from owned listings',
    persianDescription: 'دانلود فایل‌های لیستینگ‌های خریداری‌شده',
    defaultRoles: ['user'],
  },
  {
    code: 'agents:review:owned',
    description: 'Leave a review for a purchased listing',
    persianDescription: 'ثبت بازخورد برای لیستینگ خریداری‌شده',
    defaultRoles: ['user'],
  },
  {
    code: 'agents:consume:run',
    description: 'Decrement own run counter (called by maker via API key)',
    persianDescription: 'کسر شمارنده اجرا (از سمت سازنده با کلید API)',
    defaultRoles: ['user'],
  },

  // Maker-facing
  {
    code: 'agents:create:listing',
    description: 'Submit a new agent listing',
    persianDescription: 'ارسال لیستینگ ایجنت جدید',
    defaultRoles: ['user'],
  },
  {
    code: 'agents:update:listing_own',
    description: 'Edit own listings (drafts and published)',
    persianDescription: 'ویرایش لیستینگ‌های خودِ سازنده (پیش‌نویس و منتشرشده)',
    defaultRoles: ['user'],
  },
  {
    code: 'agents:read:sales_own',
    description: 'View own sales dashboard',
    persianDescription: 'مشاهده داشبورد فروش خود',
    defaultRoles: ['user'],
  },

  // Admin-facing
  {
    code: 'agents:moderate:listing',
    description: 'Approve, reject, suspend listings',
    persianDescription: 'تأیید، رد و تعلیق لیستینگ‌ها',
    defaultRoles: ['admin'],
  },
  {
    code: 'agents:manage:categories',
    description: 'CRUD on categories',
    persianDescription: 'مدیریت دسته‌بندی‌ها',
    defaultRoles: ['admin'],
  },
  {
    code: 'agents:manage:featured',
    description: 'Pin/unpin featured listings',
    persianDescription: 'انتخاب و حذف لیستینگ‌های منتخب',
    defaultRoles: ['admin'],
  },
  {
    code: 'agents:read:sales_all',
    description: 'View all sales across the marketplace',
    persianDescription: 'مشاهده همه فروش‌های بازارگاه',
    defaultRoles: ['admin'],
  },
  {
    code: 'agents:manage:settings',
    description: 'Edit module settings (commission, sections, hero copy)',
    persianDescription: 'ویرایش تنظیمات بازارگاه (کارمزد، بخش‌ها، متن هدر)',
    defaultRoles: ['admin'],
  },
] as const;

// ─── Audit actions ──────────────────────────────────────────────────────
// 18 entries per master plan §"registerAuditActions()". Used as the
// `action` field of audit_log rows; the values are intentionally equal
// to the keys so call sites can use either form interchangeably.
export const AGENTS_AUDIT_ACTIONS = {
  AGENTS_LISTING_SUBMITTED: 'AGENTS_LISTING_SUBMITTED',
  AGENTS_LISTING_APPROVED: 'AGENTS_LISTING_APPROVED',
  AGENTS_LISTING_REJECTED: 'AGENTS_LISTING_REJECTED',
  AGENTS_LISTING_SUSPENDED: 'AGENTS_LISTING_SUSPENDED',
  AGENTS_LISTING_UNSUSPENDED: 'AGENTS_LISTING_UNSUSPENDED',
  AGENTS_LISTING_UPDATED: 'AGENTS_LISTING_UPDATED',
  AGENTS_LISTING_FEATURED: 'AGENTS_LISTING_FEATURED',
  AGENTS_LISTING_UNFEATURED: 'AGENTS_LISTING_UNFEATURED',
  AGENTS_PURCHASE_COMPLETED: 'AGENTS_PURCHASE_COMPLETED',
  AGENTS_PURCHASE_REFUNDED: 'AGENTS_PURCHASE_REFUNDED',
  AGENTS_REVIEW_POSTED: 'AGENTS_REVIEW_POSTED',
  AGENTS_REVIEW_REMOVED: 'AGENTS_REVIEW_REMOVED',
  AGENTS_RUN_CONSUMED: 'AGENTS_RUN_CONSUMED',
  AGENTS_RUN_REFUSED_INSUFFICIENT: 'AGENTS_RUN_REFUSED_INSUFFICIENT',
  AGENTS_BUNDLE_DOWNLOADED: 'AGENTS_BUNDLE_DOWNLOADED',
  AGENTS_API_KEY_ROTATED: 'AGENTS_API_KEY_ROTATED',
  AGENTS_CATEGORY_CREATED: 'AGENTS_CATEGORY_CREATED',
  AGENTS_CATEGORY_UPDATED: 'AGENTS_CATEGORY_UPDATED',
  AGENTS_SETTINGS_UPDATED: 'AGENTS_SETTINGS_UPDATED',
} as const;

export type AgentsAuditAction = (typeof AGENTS_AUDIT_ACTIONS)[keyof typeof AGENTS_AUDIT_ACTIONS];

// ─── Notification types ─────────────────────────────────────────────────
// 9 templates per master plan + Phase 1B template spec. Persian copy
// only — fa-IR is the sole UI locale in v1. Each `vars` callback receives
// the runtime payload and must coerce values defensively (vars are typed
// as Record<string, unknown> at the contract level).
const str = (vars: Record<string, unknown>, key: string): string => String(vars[key] ?? '');
const num = (vars: Record<string, unknown>, key: string): string => String(vars[key] ?? 0);

export const AGENTS_NOTIFICATION_TYPES: readonly NotificationTypeDefinition[] = [
  {
    type: 'AGENTS_LISTING_APPROVED',
    inApp: {
      titleFa: 'لیستینگ شما تأیید شد',
      bodyFa: (v) => `لیستینگ "${str(v, 'listingTitle')}" منتشر شد و در بازارگاه قابل دیدن است.`,
    },
    sms: (v) => `سازیکو: لیستینگ "${str(v, 'listingTitle')}" تأیید شد.`,
  },
  {
    type: 'AGENTS_LISTING_REJECTED',
    inApp: {
      titleFa: 'لیستینگ شما رد شد',
      bodyFa: (v) => `لیستینگ "${str(v, 'listingTitle')}" تأیید نشد. دلیل: ${str(v, 'reason')}`,
    },
    sms: () => 'سازیکو: لیستینگ شما رد شد. جزئیات در پنل سازنده.',
  },
  {
    type: 'AGENTS_LISTING_SUSPENDED',
    inApp: {
      titleFa: 'لیستینگ شما تعلیق شد',
      bodyFa: (v) =>
        `لیستینگ "${str(v, 'listingTitle')}" موقتاً از بازارگاه حذف شد. دلیل: ${str(v, 'reason')}`,
    },
  },
  {
    type: 'AGENTS_PURCHASE_RECEIPT',
    inApp: {
      titleFa: 'خرید شما ثبت شد',
      bodyFa: (v) => {
        const runs = Number(v['runs'] ?? 0);
        const suffix = runs > 0 ? ` ${runs} اجرا فعال شد.` : '';
        return `"${str(v, 'listingTitle')}" به کتابخانه شما اضافه شد.${suffix}`;
      },
    },
  },
  {
    type: 'AGENTS_NEW_SALE',
    inApp: {
      titleFa: 'فروش جدید',
      bodyFa: (v) => `یک خریدار جدید لیستینگ "${str(v, 'listingTitle')}" را خرید.`,
    },
  },
  {
    type: 'AGENTS_RUNS_LOW',
    inApp: {
      titleFa: 'اجراهای شما رو به اتمام است',
      bodyFa: (v) =>
        `از "${str(v, 'listingTitle')}" تنها ${num(v, 'remaining')} اجرا باقی مانده. برای ادامه، بسته جدید بخرید.`,
    },
  },
  {
    type: 'AGENTS_RUNS_DEPLETED',
    inApp: {
      titleFa: 'اجراهای شما تمام شد',
      bodyFa: (v) =>
        `همه اجراهای "${str(v, 'listingTitle')}" مصرف شد. برای ادامه دسترسی، بسته جدید بخرید.`,
    },
  },
  {
    type: 'AGENTS_REVIEW_POSTED',
    inApp: {
      titleFa: 'بازخورد جدید روی لیستینگ شما',
      bodyFa: (v) =>
        `${str(v, 'authorName')} برای "${str(v, 'listingTitle')}" امتیاز ${num(v, 'rating')} از ۵ ثبت کرد.`,
    },
  },
  {
    type: 'AGENTS_NEW_LISTING_PENDING',
    inApp: {
      titleFa: 'لیستینگ جدید در صف بررسی',
      bodyFa: (v) =>
        `"${str(v, 'listingTitle')}" از طرف ${str(v, 'makerName')} در انتظار بررسی است.`,
    },
  },
] as const;

// ─── Admin pages ────────────────────────────────────────────────────────
// 5 pages per master plan. The admin shell (Phase 19) sorts these by
// `order` into the sidebar; the agents module reserves the 200–249 band.
export const AGENTS_ADMIN_PAGES: readonly AdminPageDefinition[] = [
  {
    path: '/admin/agents/listings',
    titleFa: 'لیستینگ‌ها',
    icon: 'package',
    permission: 'agents:moderate:listing',
    order: 200,
  },
  {
    path: '/admin/agents/categories',
    titleFa: 'دسته‌بندی‌ها',
    icon: 'folder-tree',
    permission: 'agents:manage:categories',
    order: 210,
  },
  {
    path: '/admin/agents/featured',
    titleFa: 'منتخبان',
    icon: 'star',
    permission: 'agents:manage:featured',
    order: 220,
  },
  {
    path: '/admin/agents/sales',
    titleFa: 'فروش‌ها',
    icon: 'trending-up',
    permission: 'agents:read:sales_all',
    order: 230,
  },
  {
    path: '/admin/agents/settings',
    titleFa: 'تنظیمات بازارگاه',
    icon: 'settings',
    permission: 'agents:manage:settings',
    order: 240,
  },
] as const;

// ─── Payment purposes ───────────────────────────────────────────────────
// Two purposes feed PaymentsService.registerAllowedPurposes() at boot.
// `agents_purchase` covers FREE/ONE_TIME sales; `agents_run_pack` covers
// PER_RUN pack purchases. Real ZarinPal calls are deferred (see master
// plan §"Cuts deferred from v1") — the schema is wired but the checkout
// path creates COMPLETED purchases without a Payment row until the
// system flips to live ZarinPal.
export const AGENTS_PAYMENT_PURPOSES: readonly string[] = [
  'agents_purchase',
  'agents_run_pack',
] as const;
