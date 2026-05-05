import type {
  AgentsPricingType,
  agents_listing,
  agents_review,
  agents_run_pack,
  agents_screenshot,
} from '@prisma/client';

import { makerHandle } from './handles';

export interface ListingDetailMaker {
  handle: string;
  totalListings: number;
  joinedAt: string;
}

export interface ListingDetailScreenshot {
  id: string;
  fileId: string;
  url: string;
  altTextFa: string | null;
  order: number;
}

export interface ListingDetailRunPack {
  id: string;
  nameFa: string;
  runs: string;
  priceToman: string;
  order: number;
}

export interface ListingDetailReview {
  id: string;
  rating: number;
  bodyFa: string | null;
  authorHandle: string;
  createdAt: string;
}

export interface ListingDetailOwnership {
  owns: boolean;
  runsRemaining: number | null;
}

export interface RatingDistribution {
  '1': number;
  '2': number;
  '3': number;
  '4': number;
  '5': number;
}

export interface ListingDetailDto {
  id: string;
  slug: string;
  titleFa: string;
  shortDescFa: string;
  longDescFaMd: string;
  installInstructionsFaMd: string | null;
  categoryId: string;
  categoryNameFa: string;
  categorySlug: string;
  pricingType: AgentsPricingType;
  oneTimePriceToman: string | null;
  isFeatured: boolean;
  publishedAt: string | null;
  ratingAverage: string | null;
  ratingCount: string;
  totalUsers: string;
  totalRuns: string;
  maker: ListingDetailMaker;
  screenshots: ListingDetailScreenshot[];
  runPacks: ListingDetailRunPack[];
  reviews: ListingDetailReview[];
  reviewCount: number;
  ratingDistribution: RatingDistribution;
  ownership: ListingDetailOwnership | null;
}

// Structural type matching the Prisma findFirst include used by findDetailBySlug.
export type ListingWithDetailIncludes = agents_listing & {
  category: { id: bigint; nameFa: string; slug: string };
  maker: { id: bigint; createdAt: Date };
  screenshots: Array<agents_screenshot & { file: { id: bigint } }>;
  runPacks: agents_run_pack[];
  reviews: Array<agents_review & { author: { id: bigint } }>;
};

export interface ListingDetailExtras {
  reviewCount: number;
  ratingDistribution: RatingDistribution;
  makerListingsCount: number;
  ownership: ListingDetailOwnership | null;
}

export function listingToDetailDto(
  listing: ListingWithDetailIncludes,
  extras: ListingDetailExtras,
): ListingDetailDto {
  return {
    id: listing.id.toString(),
    slug: listing.slug,
    titleFa: listing.titleFa,
    shortDescFa: listing.shortDescFa,
    longDescFaMd: listing.longDescFaMd,
    installInstructionsFaMd: listing.installInstructionsFaMd,
    categoryId: listing.category.id.toString(),
    categoryNameFa: listing.category.nameFa,
    categorySlug: listing.category.slug,
    pricingType: listing.pricingType,
    oneTimePriceToman: listing.oneTimePriceToman?.toString() ?? null,
    isFeatured: listing.isFeatured,
    publishedAt: listing.publishedAt?.toISOString() ?? null,
    ratingAverage: listing.ratingAverage?.toString() ?? null,
    ratingCount: listing.ratingCount.toString(),
    totalUsers: listing.totalUsers.toString(),
    totalRuns: listing.totalRuns.toString(),
    maker: {
      handle: makerHandle(listing.maker.id),
      totalListings: extras.makerListingsCount,
      joinedAt: listing.maker.createdAt.toISOString(),
    },
    screenshots: listing.screenshots.map((s) => ({
      id: s.id.toString(),
      fileId: s.file.id.toString(),
      url: `/api/v1/files/${s.file.id.toString()}/download`,
      altTextFa: s.altTextFa,
      order: s.order,
    })),
    runPacks: listing.runPacks.map((p) => ({
      id: p.id.toString(),
      nameFa: p.nameFa,
      runs: p.runs.toString(),
      priceToman: p.priceToman.toString(),
      order: p.order,
    })),
    reviews: listing.reviews.map((r) => ({
      id: r.id.toString(),
      rating: r.rating,
      bodyFa: r.bodyFa,
      authorHandle: makerHandle(r.author.id),
      createdAt: r.createdAt.toISOString(),
    })),
    reviewCount: extras.reviewCount,
    ratingDistribution: extras.ratingDistribution,
    ownership: extras.ownership,
  };
}
