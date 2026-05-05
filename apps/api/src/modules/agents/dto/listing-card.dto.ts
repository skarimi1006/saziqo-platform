import type { AgentsPricingType, agents_listing } from '@prisma/client';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function base62Encode(n: bigint): string {
  if (n === 0n) return '0';
  let result = '';
  const base = 62n;
  let num = n;
  while (num > 0n) {
    result = BASE62[Number(num % base)] + result;
    num = num / base;
  }
  return result;
}

export interface ListingCardDto {
  id: string;
  slug: string;
  titleFa: string;
  shortDescFa: string;
  categoryId: string;
  categoryNameFa: string;
  makerHandle: string;
  pricingType: AgentsPricingType;
  oneTimePriceToman: string | null;
  ratingAverage: string | null;
  ratingCount: string;
  totalUsers: string;
  totalRuns: string;
  primaryScreenshotUrl: string | null;
  isFeatured: boolean;
}

// Structural type matching the Prisma findMany include used by findPublished.
export type ListingWithCardIncludes = Pick<
  agents_listing,
  | 'id'
  | 'slug'
  | 'titleFa'
  | 'shortDescFa'
  | 'categoryId'
  | 'makerUserId'
  | 'pricingType'
  | 'oneTimePriceToman'
  | 'ratingAverage'
  | 'ratingCount'
  | 'totalUsers'
  | 'totalRuns'
  | 'isFeatured'
> & {
  category: { nameFa: string };
  screenshots: Array<{ file: { id: bigint } }>;
};

export function listingToCardDto(listing: ListingWithCardIncludes): ListingCardDto {
  const firstShot = listing.screenshots[0];
  return {
    id: listing.id.toString(),
    slug: listing.slug,
    titleFa: listing.titleFa,
    shortDescFa: listing.shortDescFa,
    categoryId: listing.categoryId.toString(),
    categoryNameFa: listing.category.nameFa,
    makerHandle: 'm' + base62Encode(listing.makerUserId),
    pricingType: listing.pricingType,
    oneTimePriceToman: listing.oneTimePriceToman?.toString() ?? null,
    ratingAverage: listing.ratingAverage?.toString() ?? null,
    ratingCount: listing.ratingCount.toString(),
    totalUsers: listing.totalUsers.toString(),
    totalRuns: listing.totalRuns.toString(),
    primaryScreenshotUrl: firstShot
      ? `/api/v1/files/${firstShot.file.id.toString()}/download`
      : null,
    isFeatured: listing.isFeatured,
  };
}
