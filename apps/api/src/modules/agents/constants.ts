export const AGENTS_MODULE_NAME = 'agents';
export const AGENTS_MODULE_PERSIAN_NAME = 'بازارگاه ایجنت‌ها';
export const AGENTS_MODULE_VERSION = '0.1.0';

// Maximum number of active (non-deleted) listings a single maker may own.
// Active = any status (DRAFT through SUSPENDED) with deletedAt = null.
// Plan §"Phase 4A" earmarks this for migration into agents_settings later;
// hardcoded here for v1 to keep Phase 4A schema-additive-free.
export const MAKER_LISTINGS_QUOTA = 50;
// Lower/upper bounds for run-pack array on a PER_RUN listing.
export const RUN_PACKS_MIN = 1;
export const RUN_PACKS_MAX = 5;

export const DEFAULT_CATEGORIES = [
  { slug: 'research', nameFa: 'پژوهش', iconKey: 'flask', colorToken: 'lavender', order: 10 },
  { slug: 'business', nameFa: 'کسب و کار', iconKey: 'briefcase', colorToken: 'mint', order: 20 },
  { slug: 'design', nameFa: 'تصویر و طراحی', iconKey: 'image', colorToken: 'sky', order: 30 },
  { slug: 'voice', nameFa: 'صدا و گفتار', iconKey: 'mic', colorToken: 'rose', order: 40 },
  { slug: 'data', nameFa: 'تحلیل داده', iconKey: 'bar-chart', colorToken: 'periwinkle', order: 50 },
  { slug: 'code', nameFa: 'برنامه‌نویسی', iconKey: 'command', colorToken: 'lemon', order: 60 },
  { slug: 'content', nameFa: 'نویسندگی و محتوا', iconKey: 'pencil', colorToken: 'sand', order: 70 },
] as const;

export const DEFAULT_AGENTS_SETTINGS = {
  commissionPercent: 20,
  heroTitleFa: 'عامل‌های فارسی، به دست سازندگان ایرانی.',
  heroSubtitleFa:
    'از پنل کشف عامل‌های آماده، تا استودیوی انتشار و کسب درآمد — همه در یک جا، با پرداخت ریالی، روی سرور ایران.',
  showFeaturedSection: true,
  showCategoriesSection: true,
  showBestSellersSection: true,
  showNewReleasesSection: true,
  showRecentActivitySection: true,
  featuredItemCount: 6,
  bestSellersItemCount: 8,
  newReleasesItemCount: 8,
} as const;
