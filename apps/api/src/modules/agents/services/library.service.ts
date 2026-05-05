import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AgentsPricingType, AgentsPurchaseStatus } from '@prisma/client';

import { ErrorCode } from '../../../common/types/response.types';
import { PrismaService } from '../../../core/prisma/prisma.service';

export interface LibraryRowDto {
  listingId: string;
  listingSlug: string;
  listingTitleFa: string;
  pricingType: AgentsPricingType;
  primaryScreenshotUrl: string | null;
  ownedSince: string;
  latestPurchaseDate: string;
  runsRemaining: string | null;
  totalRuns: string;
}

export interface LibraryPurchaseHistoryDto {
  // SECURITY: Only buyer-safe fields. commission and makerEarned are
  // platform-internal economics and must never leak to the buyer.
  purchaseId: string;
  pricingTypeAtSale: AgentsPricingType;
  amountToman: string;
  runsGranted: string;
  runPackId: string | null;
  status: 'COMPLETED' | 'REFUNDED';
  createdAt: string;
  refundedAt: string | null;
}

export interface LibraryDetailDto {
  listingId: string;
  listingSlug: string;
  listingTitleFa: string;
  shortDescFa: string;
  installInstructionsFaMd: string | null;
  categoryNameFa: string;
  pricingType: AgentsPricingType;
  primaryScreenshotUrl: string | null;
  ownedSince: string;
  latestPurchaseDate: string;
  runsRemaining: string | null;
  totalRuns: string;
  totalConsumed: string | null;
  bundleFileId: string | null;
  purchases: LibraryPurchaseHistoryDto[];
}

interface AggregatedRow {
  listingId: bigint;
  slug: string;
  titleFa: string;
  pricingType: AgentsPricingType;
  ownedSince: Date;
  latestPurchaseDate: Date;
  runsRemaining: bigint | null;
  totalRuns: bigint;
}

@Injectable()
export class LibraryService {
  constructor(private readonly prisma: PrismaService) {}

  async findForUser(userId: bigint): Promise<LibraryRowDto[]> {
    // CLAUDE: One row per owned listing — even if the buyer purchased
    // multiple PER_RUN packs, the LEFT JOIN to agents_user_runs collapses
    // them because that table is already (userId, listingId)-unique.
    // ownedSince = first purchase, latestPurchaseDate = most recent.
    const rows = await this.prisma.$queryRaw<AggregatedRow[]>`
      SELECT
        listing.id              AS "listingId",
        listing.slug            AS slug,
        listing."titleFa"       AS "titleFa",
        listing."pricingType"   AS "pricingType",
        MIN(purchase."createdAt") AS "ownedSince",
        MAX(purchase."createdAt") AS "latestPurchaseDate",
        runs."remainingRuns"    AS "runsRemaining",
        COALESCE(runs."totalGranted", 0) AS "totalRuns"
      FROM agents_purchase purchase
      JOIN agents_listing  listing ON listing.id = purchase."listingId"
      LEFT JOIN agents_user_runs runs
        ON runs."userId" = purchase."userId"
       AND runs."listingId" = purchase."listingId"
      WHERE purchase."userId" = ${userId}
        AND purchase.status = 'COMPLETED'::"AgentsPurchaseStatus"
      GROUP BY listing.id, runs."remainingRuns", runs."totalGranted"
      ORDER BY MAX(purchase."createdAt") DESC
    `;

    if (rows.length === 0) return [];

    // Pull primary screenshot for each owned listing in a single query.
    const screenshotMap = await this.findPrimaryScreenshots(rows.map((r) => r.listingId));

    return rows.map((r) => ({
      listingId: r.listingId.toString(),
      listingSlug: r.slug,
      listingTitleFa: r.titleFa,
      pricingType: r.pricingType,
      primaryScreenshotUrl: screenshotMap.get(r.listingId.toString()) ?? null,
      ownedSince: r.ownedSince.toISOString(),
      latestPurchaseDate: r.latestPurchaseDate.toISOString(),
      runsRemaining:
        r.pricingType === AgentsPricingType.PER_RUN && r.runsRemaining !== null
          ? r.runsRemaining.toString()
          : null,
      totalRuns: r.totalRuns.toString(),
    }));
  }

  async findDetailForUser(userId: bigint, listingId: bigint): Promise<LibraryDetailDto> {
    // SECURITY: confirm ownership BEFORE returning listing internals.
    // Without this check, any authenticated user could read installation
    // instructions and bundle ids by guessing listing IDs.
    const purchases = await this.prisma.agents_purchase.findMany({
      where: { userId, listingId, status: AgentsPurchaseStatus.COMPLETED },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        pricingTypeAtSale: true,
        amountToman: true,
        runsGranted: true,
        runPackId: true,
        status: true,
        createdAt: true,
        refundedAt: true,
      },
    });

    if (purchases.length === 0) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'You do not own this listing' },
        HttpStatus.NOT_FOUND,
      );
    }

    const listing = await this.prisma.agents_listing.findFirst({
      where: { id: listingId, deletedAt: null },
      select: {
        id: true,
        slug: true,
        titleFa: true,
        shortDescFa: true,
        installInstructionsFaMd: true,
        pricingType: true,
        bundleFileId: true,
        category: { select: { nameFa: true } },
        screenshots: {
          take: 1,
          orderBy: { order: 'asc' },
          select: { fileId: true },
        },
      },
    });

    if (!listing) {
      throw new HttpException(
        { code: ErrorCode.LISTING_NOT_FOUND, message: 'Listing not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    const runs = await this.prisma.agents_user_runs.findUnique({
      where: { userId_listingId: { userId, listingId } },
      select: { remainingRuns: true, totalGranted: true, totalConsumed: true },
    });

    const ownedSince = purchases[0]!.createdAt;
    const latestPurchaseDate = purchases[purchases.length - 1]!.createdAt;
    const screenshotFileId = listing.screenshots[0]?.fileId ?? null;

    return {
      listingId: listing.id.toString(),
      listingSlug: listing.slug,
      listingTitleFa: listing.titleFa,
      shortDescFa: listing.shortDescFa,
      installInstructionsFaMd: listing.installInstructionsFaMd,
      categoryNameFa: listing.category.nameFa,
      pricingType: listing.pricingType,
      primaryScreenshotUrl:
        screenshotFileId !== null ? `/api/v1/files/${screenshotFileId.toString()}/download` : null,
      ownedSince: ownedSince.toISOString(),
      latestPurchaseDate: latestPurchaseDate.toISOString(),
      runsRemaining:
        listing.pricingType === AgentsPricingType.PER_RUN
          ? (runs?.remainingRuns ?? 0n).toString()
          : null,
      totalRuns: (runs?.totalGranted ?? 0n).toString(),
      totalConsumed:
        listing.pricingType === AgentsPricingType.PER_RUN
          ? (runs?.totalConsumed ?? 0n).toString()
          : null,
      bundleFileId: listing.bundleFileId?.toString() ?? null,
      purchases: purchases.map((p) => ({
        purchaseId: p.id.toString(),
        pricingTypeAtSale: p.pricingTypeAtSale,
        amountToman: p.amountToman.toString(),
        runsGranted: p.runsGranted.toString(),
        runPackId: p.runPackId?.toString() ?? null,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        refundedAt: p.refundedAt?.toISOString() ?? null,
      })),
    };
  }

  private async findPrimaryScreenshots(listingIds: bigint[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (listingIds.length === 0) return map;
    const shots = await this.prisma.agents_screenshot.findMany({
      where: { listingId: { in: listingIds } },
      orderBy: [{ listingId: 'asc' }, { order: 'asc' }],
      select: { listingId: true, fileId: true },
    });
    for (const s of shots) {
      const key = s.listingId.toString();
      if (!map.has(key)) {
        map.set(key, `/api/v1/files/${s.fileId.toString()}/download`);
      }
    }
    return map;
  }
}
