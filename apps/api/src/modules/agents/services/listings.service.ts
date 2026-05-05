import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  AgentsListingStatus,
  AgentsPricingType,
  Prisma,
  type agents_listing,
} from '@prisma/client';

import { ErrorCode } from '../../../common/types/response.types';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AGENTS_AUDIT_ACTIONS } from '../contract';
import type { ListingWithCardIncludes } from '../dto/listing-card.dto';
import type { AgentsPricingTypeName } from '../types';

// CLAUDE: Status transitions are encoded per-method, not as a flat matrix:
// the same edge (e.g. PUBLISHED → PENDING_REVIEW) belongs to a different
// method depending on who triggers it. submitForReview is the maker's
// "draft → ready to review" action (DRAFT only); the PUBLISHED →
// PENDING_REVIEW edge is reserved for Phase 4B (maker edits) and is NOT
// reachable through any method exposed here.
const ALLOWED_FROM = {
  submitForReview: [AgentsListingStatus.DRAFT],
  approve: [AgentsListingStatus.PENDING_REVIEW],
  reject: [AgentsListingStatus.PENDING_REVIEW],
  suspend: [AgentsListingStatus.PUBLISHED],
  unsuspend: [AgentsListingStatus.SUSPENDED],
} as const;

const LISTING_RESOURCE = 'agents_listing';

export interface AuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CreateListingInput {
  slug: string;
  titleFa: string;
  shortDescFa: string;
  longDescFaMd: string;
  categoryId: bigint;
  pricingType: AgentsPricingTypeName;
  oneTimePriceToman?: bigint | null;
  installInstructionsFaMd?: string | null;
  bundleFileId?: bigint | null;
}

export interface FindPublishedFilters {
  categoryId?: bigint | undefined;
  pricingType?: AgentsPricingType | undefined;
  freeOnly?: boolean | undefined;
  minRating?: number | undefined;
}

export interface FindPublishedInput {
  filters: FindPublishedFilters;
  cursor?: bigint | undefined;
  limit: number;
  sort: 'newest' | 'most-installed' | 'top-rated';
}

export interface FindPublishedResult {
  items: ListingWithCardIncludes[];
  nextCursor: bigint | null;
  hasMore: boolean;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class ListingsService {
  private readonly logger = new Logger(ListingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ─── Read methods ──────────────────────────────────────────────────────

  async findPublishedById(id: bigint): Promise<agents_listing | null> {
    return this.prisma.agents_listing.findFirst({
      where: { id, status: AgentsListingStatus.PUBLISHED, deletedAt: null },
    });
  }

  async findPublishedBySlug(slug: string): Promise<agents_listing | null> {
    return this.prisma.agents_listing.findFirst({
      where: { slug, status: AgentsListingStatus.PUBLISHED, deletedAt: null },
    });
  }

  async findByIdForMaker(id: bigint, makerUserId: bigint): Promise<agents_listing | null> {
    return this.prisma.agents_listing.findFirst({
      where: { id, makerUserId, deletedAt: null },
    });
  }

  async findByIdForAdmin(id: bigint): Promise<agents_listing | null> {
    return this.prisma.agents_listing.findFirst({ where: { id, deletedAt: null } });
  }

  async findPublished(input: FindPublishedInput): Promise<FindPublishedResult> {
    const { filters, cursor, limit, sort } = input;

    const where: Prisma.agents_listingWhereInput = {
      status: AgentsListingStatus.PUBLISHED,
      deletedAt: null,
    };

    if (filters.categoryId !== undefined) {
      where.categoryId = filters.categoryId;
    }

    if (filters.freeOnly === true) {
      where.pricingType = AgentsPricingType.FREE;
    } else if (filters.pricingType !== undefined) {
      where.pricingType = filters.pricingType;
    }

    if (filters.minRating !== undefined) {
      where.ratingAverage = { gte: new Prisma.Decimal(filters.minRating) };
    }

    if (cursor !== undefined) {
      where.id = { lt: cursor };
    }

    const orderBy: Prisma.agents_listingOrderByWithRelationInput[] = [];
    switch (sort) {
      case 'newest':
        orderBy.push({ publishedAt: { sort: 'desc', nulls: 'last' } });
        break;
      case 'most-installed':
        orderBy.push({ totalUsers: 'desc' });
        break;
      case 'top-rated':
        orderBy.push({ ratingAverage: { sort: 'desc', nulls: 'last' } });
        break;
    }
    orderBy.push({ id: 'desc' });

    const rows = await this.prisma.agents_listing.findMany({
      where,
      orderBy,
      take: limit + 1,
      include: {
        category: { select: { nameFa: true } },
        screenshots: {
          take: 1,
          orderBy: { order: 'asc' },
          include: { file: { select: { id: true } } },
        },
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;

    return {
      items: items as unknown as ListingWithCardIncludes[],
      nextCursor,
      hasMore,
    };
  }

  // ─── Create ────────────────────────────────────────────────────────────

  async create(input: { makerUserId: bigint; dto: CreateListingInput }): Promise<agents_listing> {
    return this.prisma.agents_listing.create({
      data: {
        makerUserId: input.makerUserId,
        slug: input.dto.slug,
        titleFa: input.dto.titleFa,
        shortDescFa: input.dto.shortDescFa,
        longDescFaMd: input.dto.longDescFaMd,
        installInstructionsFaMd: input.dto.installInstructionsFaMd ?? null,
        categoryId: input.dto.categoryId,
        pricingType: input.dto.pricingType,
        oneTimePriceToman: input.dto.oneTimePriceToman ?? null,
        bundleFileId: input.dto.bundleFileId ?? null,
        status: AgentsListingStatus.DRAFT,
      },
    });
  }

  // ─── Status transitions ────────────────────────────────────────────────

  async submitForReview(
    id: bigint,
    makerUserId: bigint,
    ctx?: AuditContext,
  ): Promise<agents_listing> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockAndLoad(tx, id);
      if (current.makerUserId !== makerUserId) {
        // SECURITY: do not leak existence of listings the caller does not own.
        throw listingNotFound();
      }
      this.assertTransition(
        current.status,
        ALLOWED_FROM.submitForReview,
        AgentsListingStatus.PENDING_REVIEW,
      );

      const next = await tx.agents_listing.update({
        where: { id },
        data: { status: AgentsListingStatus.PENDING_REVIEW },
      });

      const adminIds = await this.findAdminUserIds(tx);
      const makerName = `m.${next.makerUserId.toString()}`;
      for (const adminId of adminIds) {
        await this.notifications.dispatch({
          userId: adminId,
          type: 'AGENTS_NEW_LISTING_PENDING',
          payload: { listingTitle: next.titleFa, makerName },
          channels: ['IN_APP'],
        });
      }
      return next;
    });

    await this.audit.log({
      actorUserId: makerUserId,
      action: AGENTS_AUDIT_ACTIONS.AGENTS_LISTING_SUBMITTED,
      resource: LISTING_RESOURCE,
      resourceId: updated.id,
      payload: {
        fromStatus: AgentsListingStatus.DRAFT,
        toStatus: AgentsListingStatus.PENDING_REVIEW,
      },
      ipAddress: ctx?.ipAddress ?? null,
      userAgent: ctx?.userAgent ?? null,
    });

    return updated;
  }

  async approve(id: bigint, adminUserId: bigint, ctx?: AuditContext): Promise<agents_listing> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockAndLoad(tx, id);
      this.assertTransition(current.status, ALLOWED_FROM.approve, AgentsListingStatus.PUBLISHED);

      const next = await tx.agents_listing.update({
        where: { id },
        data: {
          status: AgentsListingStatus.PUBLISHED,
          // Preserve original publishedAt for first-published-date semantics.
          publishedAt: current.publishedAt ?? new Date(),
          rejectionReason: null,
          suspensionReason: null,
        },
      });

      await this.notifications.dispatch({
        userId: next.makerUserId,
        type: 'AGENTS_LISTING_APPROVED',
        payload: { listingTitle: next.titleFa },
        channels: ['IN_APP'],
      });
      return next;
    });

    // Post-commit SMS — failure must not roll back the approval.
    void this.notifications
      .dispatch({
        userId: updated.makerUserId,
        type: 'AGENTS_LISTING_APPROVED',
        payload: { listingTitle: updated.titleFa },
        channels: ['SMS'],
      })
      .catch((err) => this.logger.error(`Post-commit SMS failed: ${String(err)}`));

    await this.audit.log({
      actorUserId: adminUserId,
      action: AGENTS_AUDIT_ACTIONS.AGENTS_LISTING_APPROVED,
      resource: LISTING_RESOURCE,
      resourceId: updated.id,
      payload: { toStatus: AgentsListingStatus.PUBLISHED },
      ipAddress: ctx?.ipAddress ?? null,
      userAgent: ctx?.userAgent ?? null,
    });

    return updated;
  }

  async reject(
    id: bigint,
    adminUserId: bigint,
    reason: string,
    ctx?: AuditContext,
  ): Promise<agents_listing> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockAndLoad(tx, id);
      this.assertTransition(current.status, ALLOWED_FROM.reject, AgentsListingStatus.REJECTED);

      const next = await tx.agents_listing.update({
        where: { id },
        data: { status: AgentsListingStatus.REJECTED, rejectionReason: reason },
      });

      await this.notifications.dispatch({
        userId: next.makerUserId,
        type: 'AGENTS_LISTING_REJECTED',
        payload: { listingTitle: next.titleFa, reason },
        channels: ['IN_APP'],
      });
      return next;
    });

    void this.notifications
      .dispatch({
        userId: updated.makerUserId,
        type: 'AGENTS_LISTING_REJECTED',
        payload: { listingTitle: updated.titleFa, reason },
        channels: ['SMS'],
      })
      .catch((err) => this.logger.error(`Post-commit SMS failed: ${String(err)}`));

    await this.audit.log({
      actorUserId: adminUserId,
      action: AGENTS_AUDIT_ACTIONS.AGENTS_LISTING_REJECTED,
      resource: LISTING_RESOURCE,
      resourceId: updated.id,
      payload: { toStatus: AgentsListingStatus.REJECTED, reason },
      ipAddress: ctx?.ipAddress ?? null,
      userAgent: ctx?.userAgent ?? null,
    });

    return updated;
  }

  async suspend(
    id: bigint,
    adminUserId: bigint,
    reason: string,
    ctx?: AuditContext,
  ): Promise<agents_listing> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockAndLoad(tx, id);
      this.assertTransition(current.status, ALLOWED_FROM.suspend, AgentsListingStatus.SUSPENDED);

      const next = await tx.agents_listing.update({
        where: { id },
        data: { status: AgentsListingStatus.SUSPENDED, suspensionReason: reason },
      });

      await this.notifications.dispatch({
        userId: next.makerUserId,
        type: 'AGENTS_LISTING_SUSPENDED',
        payload: { listingTitle: next.titleFa, reason },
        channels: ['IN_APP'],
      });
      return next;
    });

    await this.audit.log({
      actorUserId: adminUserId,
      action: AGENTS_AUDIT_ACTIONS.AGENTS_LISTING_SUSPENDED,
      resource: LISTING_RESOURCE,
      resourceId: updated.id,
      payload: { toStatus: AgentsListingStatus.SUSPENDED, reason },
      ipAddress: ctx?.ipAddress ?? null,
      userAgent: ctx?.userAgent ?? null,
    });

    return updated;
  }

  async unsuspend(id: bigint, adminUserId: bigint, ctx?: AuditContext): Promise<agents_listing> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockAndLoad(tx, id);
      this.assertTransition(current.status, ALLOWED_FROM.unsuspend, AgentsListingStatus.PUBLISHED);

      return tx.agents_listing.update({
        where: { id },
        data: { status: AgentsListingStatus.PUBLISHED, suspensionReason: null },
      });
    });

    await this.audit.log({
      actorUserId: adminUserId,
      action: AGENTS_AUDIT_ACTIONS.AGENTS_LISTING_UNSUSPENDED,
      resource: LISTING_RESOURCE,
      resourceId: updated.id,
      payload: { toStatus: AgentsListingStatus.PUBLISHED },
      ipAddress: ctx?.ipAddress ?? null,
      userAgent: ctx?.userAgent ?? null,
    });

    return updated;
  }

  // ─── Counters / rating / soft-delete ──────────────────────────────────

  async incrementUserCount(listingId: bigint): Promise<void> {
    await this.prisma.agents_listing.update({
      where: { id: listingId },
      data: { totalUsers: { increment: 1 } },
    });
  }

  async incrementRunCount(listingId: bigint): Promise<void> {
    await this.prisma.agents_listing.update({
      where: { id: listingId },
      data: { totalRuns: { increment: 1 } },
    });
  }

  async recomputeRating(listingId: bigint): Promise<void> {
    const agg = await this.prisma.agents_review.aggregate({
      where: { listingId, isHidden: false },
      _avg: { rating: true },
      _count: { _all: true },
    });
    const avg = agg._avg.rating;
    await this.prisma.agents_listing.update({
      where: { id: listingId },
      data: {
        ratingAverage: avg !== null ? new Prisma.Decimal(avg).toDecimalPlaces(2) : null,
        ratingCount: BigInt(agg._count._all),
      },
    });
  }

  async softDelete(id: bigint, adminUserId: bigint, ctx?: AuditContext): Promise<void> {
    await this.prisma.agents_listing.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      actorUserId: adminUserId,
      action: AGENTS_AUDIT_ACTIONS.AGENTS_LISTING_UPDATED,
      resource: LISTING_RESOURCE,
      resourceId: id,
      payload: { softDeleted: true },
      ipAddress: ctx?.ipAddress ?? null,
      userAgent: ctx?.userAgent ?? null,
    });
  }

  // ─── Internals ────────────────────────────────────────────────────────

  // Acquires a row-level lock on the listing to serialize concurrent state
  // transitions, then loads the full row. Throws LISTING_NOT_FOUND if the
  // row is missing or soft-deleted. Must be called inside $transaction.
  private async lockAndLoad(tx: Tx, id: bigint): Promise<agents_listing> {
    const locked = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM agents_listing WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE
    `;
    if (locked.length === 0) {
      throw listingNotFound();
    }
    const listing = await tx.agents_listing.findUnique({ where: { id } });
    if (!listing || listing.deletedAt !== null) {
      throw listingNotFound();
    }
    return listing;
  }

  private assertTransition(
    from: AgentsListingStatus,
    allowedFrom: readonly AgentsListingStatus[],
    to: AgentsListingStatus,
  ): void {
    if (!allowedFrom.includes(from)) {
      throw new HttpException(
        {
          code: ErrorCode.INVALID_STATUS_TRANSITION,
          message: `Cannot transition listing from ${from} to ${to}`,
          details: { from, to },
        },
        HttpStatus.CONFLICT,
      );
    }
  }

  private async findAdminUserIds(tx: Tx): Promise<bigint[]> {
    const rows = await tx.userRole.findMany({
      where: { role: { name: { in: ['admin', 'super_admin'] } } },
      select: { userId: true },
    });
    return Array.from(new Set(rows.map((r) => r.userId)));
  }
}

function listingNotFound(): HttpException {
  return new HttpException(
    { code: ErrorCode.LISTING_NOT_FOUND, message: 'Listing not found' },
    HttpStatus.NOT_FOUND,
  );
}
