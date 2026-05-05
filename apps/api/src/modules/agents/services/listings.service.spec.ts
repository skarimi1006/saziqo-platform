import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AgentsListingStatus, AgentsPricingType, AgentsPurchaseStatus } from '@prisma/client';

import { ErrorCode } from '../../../common/types/response.types';
import { AuditService } from '../../../core/audit/audit.service';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { RedisService } from '../../../core/redis/redis.service';
import { AGENTS_AUDIT_ACTIONS } from '../contract';

import { CategoriesService } from './categories.service';
import { ListingsService } from './listings.service';

interface MockListingRow {
  id: bigint;
  makerUserId: bigint;
  status: AgentsListingStatus;
  titleFa: string;
  publishedAt: Date | null;
  deletedAt: Date | null;
}

const makeListing = (overrides: Partial<MockListingRow> = {}): MockListingRow => ({
  id: 1n,
  makerUserId: 100n,
  status: AgentsListingStatus.DRAFT,
  titleFa: 'ایجنت تست',
  publishedAt: null,
  deletedAt: null,
  ...overrides,
});

describe('ListingsService', () => {
  let service: ListingsService;
  let listingStore: MockListingRow | null;
  let queryRawMock: jest.Mock;
  let agentsListingFindUnique: jest.Mock;
  let agentsListingFindFirst: jest.Mock;
  let agentsListingUpdate: jest.Mock;
  let userRoleFindMany: jest.Mock;
  let agentsPurchaseFindFirst: jest.Mock;
  let agentsUserRunsFindUnique: jest.Mock;
  let agentsReviewGroupBy: jest.Mock;
  let dispatch: jest.Mock;
  let auditLog: jest.Mock;

  const adminId = 9n;
  const makerId = 100n;
  const listingId = 1n;

  beforeEach(async () => {
    listingStore = makeListing();

    queryRawMock = jest.fn(async () =>
      listingStore && listingStore.deletedAt === null ? [{ id: listingStore.id }] : [],
    );
    agentsListingFindUnique = jest.fn(async () => listingStore);
    agentsListingFindFirst = jest.fn(async () => listingStore);
    agentsListingUpdate = jest.fn(async ({ data }: { data: Partial<MockListingRow> }) => {
      if (!listingStore) throw new Error('listing not found');
      listingStore = { ...listingStore, ...data };
      return listingStore;
    });
    userRoleFindMany = jest.fn(async () => [
      { userId: adminId },
      { userId: adminId },
      { userId: 8n },
    ]);

    interface MockTx {
      $queryRaw: jest.Mock;
      agents_listing: { findUnique: jest.Mock; update: jest.Mock };
      userRole: { findMany: jest.Mock };
    }

    const tx: MockTx = {
      $queryRaw: queryRawMock,
      agents_listing: { findUnique: agentsListingFindUnique, update: agentsListingUpdate },
      userRole: { findMany: userRoleFindMany },
    };

    agentsPurchaseFindFirst = jest.fn(async () => null);
    agentsUserRunsFindUnique = jest.fn(async () => null);
    agentsReviewGroupBy = jest.fn(async () => []);

    const prisma = {
      $transaction: jest.fn(async (cb: (tx: MockTx) => unknown) => cb(tx)),
      agents_listing: {
        findFirst: agentsListingFindFirst,
        findUnique: agentsListingFindUnique,
        create: jest.fn(async ({ data }: { data: MockListingRow }) => ({
          ...listingStore,
          ...data,
        })),
        update: agentsListingUpdate,
      },
      agents_review: {
        aggregate: jest.fn(async () => ({ _avg: { rating: 4.5 }, _count: { _all: 2 } })),
        groupBy: agentsReviewGroupBy,
      },
      agents_purchase: { findFirst: agentsPurchaseFindFirst },
      agents_user_runs: { findUnique: agentsUserRunsFindUnique },
    };

    dispatch = jest.fn(async () => ({ dispatched: ['IN_APP'], failures: [] }));
    auditLog = jest.fn(async () => undefined);

    const redisMock = {
      getClient: () => ({
        get: jest.fn(async () => null),
        setex: jest.fn(async () => 'OK'),
        del: jest.fn(async () => 4),
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ListingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { dispatch } },
        { provide: AuditService, useValue: { log: auditLog } },
        { provide: RedisService, useValue: redisMock },
        {
          provide: CategoriesService,
          useValue: { invalidateCache: jest.fn(async () => undefined) },
        },
      ],
    }).compile();

    service = moduleRef.get(ListingsService);
  });

  // ─── Read methods ────────────────────────────────────────────────

  describe('reads', () => {
    it('findPublishedById filters by status PUBLISHED and not deleted', async () => {
      await service.findPublishedById(listingId);
      expect(agentsListingFindFirst).toHaveBeenCalledWith({
        where: { id: listingId, status: AgentsListingStatus.PUBLISHED, deletedAt: null },
      });
    });

    it('findPublishedBySlug filters by slug + status + not deleted', async () => {
      await service.findPublishedBySlug('persian-copywriter');
      expect(agentsListingFindFirst).toHaveBeenCalledWith({
        where: {
          slug: 'persian-copywriter',
          status: AgentsListingStatus.PUBLISHED,
          deletedAt: null,
        },
      });
    });

    it('findByIdForMaker scopes to owning maker', async () => {
      await service.findByIdForMaker(listingId, makerId);
      expect(agentsListingFindFirst).toHaveBeenCalledWith({
        where: { id: listingId, makerUserId: makerId, deletedAt: null },
      });
    });

    it('findByIdForAdmin returns any non-deleted status', async () => {
      await service.findByIdForAdmin(listingId);
      expect(agentsListingFindFirst).toHaveBeenCalledWith({
        where: { id: listingId, deletedAt: null },
      });
    });
  });

  // ─── Valid transitions ───────────────────────────────────────────

  describe('valid transitions', () => {
    it('submitForReview: DRAFT → PENDING_REVIEW + admin notify + audit', async () => {
      listingStore = makeListing({ status: AgentsListingStatus.DRAFT, makerUserId: makerId });

      const updated = await service.submitForReview(listingId, makerId);

      expect(updated.status).toBe(AgentsListingStatus.PENDING_REVIEW);
      expect(queryRawMock).toHaveBeenCalledTimes(1); // FOR UPDATE row lock
      expect(agentsListingUpdate).toHaveBeenCalledWith({
        where: { id: listingId },
        data: { status: AgentsListingStatus.PENDING_REVIEW },
      });
      // Two distinct admin user IDs (deduped from three rows).
      expect(dispatch).toHaveBeenCalledTimes(2);
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'AGENTS_NEW_LISTING_PENDING',
          channels: ['IN_APP'],
        }),
      );
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AGENTS_AUDIT_ACTIONS.AGENTS_LISTING_SUBMITTED,
          actorUserId: makerId,
          resource: 'agents_listing',
          resourceId: listingId,
        }),
      );
    });

    it('approve: PENDING_REVIEW → PUBLISHED, sets publishedAt + maker IN_APP + post-commit SMS', async () => {
      listingStore = makeListing({
        status: AgentsListingStatus.PENDING_REVIEW,
        makerUserId: makerId,
      });

      const updated = await service.approve(listingId, adminId);

      expect(updated.status).toBe(AgentsListingStatus.PUBLISHED);
      expect(agentsListingUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: listingId },
          data: expect.objectContaining({
            status: AgentsListingStatus.PUBLISHED,
            publishedAt: expect.any(Date),
            rejectionReason: null,
            suspensionReason: null,
          }),
        }),
      );
      // Within-txn IN_APP plus post-commit SMS.
      const channels = dispatch.mock.calls.map((c) => c[0].channels);
      expect(channels).toContainEqual(['IN_APP']);
      expect(channels).toContainEqual(['SMS']);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AGENTS_AUDIT_ACTIONS.AGENTS_LISTING_APPROVED,
          actorUserId: adminId,
        }),
      );
    });

    it('approve: preserves existing publishedAt across re-approval', async () => {
      const original = new Date('2026-01-01T00:00:00Z');
      listingStore = makeListing({
        status: AgentsListingStatus.PENDING_REVIEW,
        publishedAt: original,
      });

      await service.approve(listingId, adminId);

      const callArgs = agentsListingUpdate.mock.calls[0][0] as {
        data: { publishedAt: Date };
      };
      expect(callArgs.data.publishedAt).toBe(original);
    });

    it('reject: PENDING_REVIEW → REJECTED with reason + IN_APP + SMS + audit', async () => {
      listingStore = makeListing({ status: AgentsListingStatus.PENDING_REVIEW });

      const updated = await service.reject(listingId, adminId, 'محتوای ناکافی');

      expect(updated.status).toBe(AgentsListingStatus.REJECTED);
      expect(agentsListingUpdate).toHaveBeenCalledWith({
        where: { id: listingId },
        data: { status: AgentsListingStatus.REJECTED, rejectionReason: 'محتوای ناکافی' },
      });
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'AGENTS_LISTING_REJECTED',
          channels: ['IN_APP'],
          payload: expect.objectContaining({ reason: 'محتوای ناکافی' }),
        }),
      );
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AGENTS_AUDIT_ACTIONS.AGENTS_LISTING_REJECTED,
          payload: expect.objectContaining({ reason: 'محتوای ناکافی' }),
        }),
      );
    });

    it('suspend: PUBLISHED → SUSPENDED with reason + IN_APP + audit', async () => {
      listingStore = makeListing({ status: AgentsListingStatus.PUBLISHED });

      const updated = await service.suspend(listingId, adminId, 'گزارش سوءاستفاده');

      expect(updated.status).toBe(AgentsListingStatus.SUSPENDED);
      expect(agentsListingUpdate).toHaveBeenCalledWith({
        where: { id: listingId },
        data: {
          status: AgentsListingStatus.SUSPENDED,
          suspensionReason: 'گزارش سوءاستفاده',
        },
      });
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AGENTS_AUDIT_ACTIONS.AGENTS_LISTING_SUSPENDED,
        }),
      );
    });

    it('unsuspend: SUSPENDED → PUBLISHED, clears suspensionReason + audit', async () => {
      listingStore = makeListing({
        status: AgentsListingStatus.SUSPENDED,
      });

      const updated = await service.unsuspend(listingId, adminId);

      expect(updated.status).toBe(AgentsListingStatus.PUBLISHED);
      expect(agentsListingUpdate).toHaveBeenCalledWith({
        where: { id: listingId },
        data: { status: AgentsListingStatus.PUBLISHED, suspensionReason: null },
      });
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AGENTS_AUDIT_ACTIONS.AGENTS_LISTING_UNSUSPENDED,
        }),
      );
    });
  });

  // ─── Invalid transitions ─────────────────────────────────────────

  describe('invalid transitions throw INVALID_STATUS_TRANSITION', () => {
    const expectInvalidTransition = async (fn: () => Promise<unknown>): Promise<void> => {
      try {
        await fn();
        throw new Error('expected INVALID_STATUS_TRANSITION to be thrown but call resolved');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getResponse()).toMatchObject({
          code: ErrorCode.INVALID_STATUS_TRANSITION,
        });
      }
    };

    const cases: Array<{
      name: string;
      from: AgentsListingStatus;
      run: () => Promise<unknown>;
    }> = [
      {
        name: 'submitForReview from PENDING_REVIEW',
        from: AgentsListingStatus.PENDING_REVIEW,
        run: () => service.submitForReview(listingId, makerId),
      },
      {
        name: 'submitForReview from PUBLISHED',
        from: AgentsListingStatus.PUBLISHED,
        run: () => service.submitForReview(listingId, makerId),
      },
      {
        name: 'submitForReview from REJECTED',
        from: AgentsListingStatus.REJECTED,
        run: () => service.submitForReview(listingId, makerId),
      },
      {
        name: 'submitForReview from SUSPENDED',
        from: AgentsListingStatus.SUSPENDED,
        run: () => service.submitForReview(listingId, makerId),
      },
      {
        name: 'approve from DRAFT',
        from: AgentsListingStatus.DRAFT,
        run: () => service.approve(listingId, adminId),
      },
      {
        name: 'approve from PUBLISHED',
        from: AgentsListingStatus.PUBLISHED,
        run: () => service.approve(listingId, adminId),
      },
      {
        name: 'approve from REJECTED',
        from: AgentsListingStatus.REJECTED,
        run: () => service.approve(listingId, adminId),
      },
      {
        name: 'approve from SUSPENDED',
        from: AgentsListingStatus.SUSPENDED,
        run: () => service.approve(listingId, adminId),
      },
      {
        name: 'reject from DRAFT',
        from: AgentsListingStatus.DRAFT,
        run: () => service.reject(listingId, adminId, 'r'),
      },
      {
        name: 'reject from PUBLISHED',
        from: AgentsListingStatus.PUBLISHED,
        run: () => service.reject(listingId, adminId, 'r'),
      },
      {
        name: 'reject from REJECTED',
        from: AgentsListingStatus.REJECTED,
        run: () => service.reject(listingId, adminId, 'r'),
      },
      {
        name: 'reject from SUSPENDED',
        from: AgentsListingStatus.SUSPENDED,
        run: () => service.reject(listingId, adminId, 'r'),
      },
      {
        name: 'suspend from DRAFT',
        from: AgentsListingStatus.DRAFT,
        run: () => service.suspend(listingId, adminId, 'r'),
      },
      {
        name: 'suspend from PENDING_REVIEW',
        from: AgentsListingStatus.PENDING_REVIEW,
        run: () => service.suspend(listingId, adminId, 'r'),
      },
      {
        name: 'suspend from REJECTED (the canonical guard rail)',
        from: AgentsListingStatus.REJECTED,
        run: () => service.suspend(listingId, adminId, 'r'),
      },
      {
        name: 'suspend from SUSPENDED',
        from: AgentsListingStatus.SUSPENDED,
        run: () => service.suspend(listingId, adminId, 'r'),
      },
      {
        name: 'unsuspend from DRAFT',
        from: AgentsListingStatus.DRAFT,
        run: () => service.unsuspend(listingId, adminId),
      },
      {
        name: 'unsuspend from PENDING_REVIEW',
        from: AgentsListingStatus.PENDING_REVIEW,
        run: () => service.unsuspend(listingId, adminId),
      },
      {
        name: 'unsuspend from PUBLISHED',
        from: AgentsListingStatus.PUBLISHED,
        run: () => service.unsuspend(listingId, adminId),
      },
      {
        name: 'unsuspend from REJECTED',
        from: AgentsListingStatus.REJECTED,
        run: () => service.unsuspend(listingId, adminId),
      },
    ];

    cases.forEach(({ name, from, run }) => {
      it(name, async () => {
        listingStore = makeListing({ status: from, makerUserId: makerId });
        await expectInvalidTransition(run);
        // No update or audit on invalid transition.
        expect(agentsListingUpdate).not.toHaveBeenCalled();
        expect(auditLog).not.toHaveBeenCalled();
      });
    });
  });

  // ─── LISTING_NOT_FOUND ───────────────────────────────────────────

  describe('LISTING_NOT_FOUND', () => {
    const expectNotFound = async (fn: () => Promise<unknown>): Promise<void> => {
      try {
        await fn();
        throw new Error('expected LISTING_NOT_FOUND to be thrown but call resolved');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getResponse()).toMatchObject({
          code: ErrorCode.LISTING_NOT_FOUND,
        });
      }
    };

    it('submitForReview throws when listing missing', async () => {
      listingStore = null;
      await expectNotFound(() => service.submitForReview(listingId, makerId));
    });

    it('submitForReview throws when listing is soft-deleted', async () => {
      listingStore = makeListing({ deletedAt: new Date() });
      await expectNotFound(() => service.submitForReview(listingId, makerId));
    });

    it('submitForReview throws when caller is not the owning maker', async () => {
      listingStore = makeListing({ makerUserId: 999n });
      await expectNotFound(() => service.submitForReview(listingId, makerId));
    });

    it('approve throws when listing missing', async () => {
      listingStore = null;
      await expectNotFound(() => service.approve(listingId, adminId));
    });

    it('reject throws when listing missing', async () => {
      listingStore = null;
      await expectNotFound(() => service.reject(listingId, adminId, 'r'));
    });

    it('suspend throws when listing missing', async () => {
      listingStore = null;
      await expectNotFound(() => service.suspend(listingId, adminId, 'r'));
    });

    it('unsuspend throws when listing missing', async () => {
      listingStore = null;
      await expectNotFound(() => service.unsuspend(listingId, adminId));
    });
  });

  // ─── Concurrency: row lock acquired on every transition ──────────

  describe('row lock', () => {
    it.each([
      [
        'submitForReview',
        AgentsListingStatus.DRAFT,
        () => service.submitForReview(listingId, makerId),
      ],
      ['approve', AgentsListingStatus.PENDING_REVIEW, () => service.approve(listingId, adminId)],
      ['reject', AgentsListingStatus.PENDING_REVIEW, () => service.reject(listingId, adminId, 'r')],
      ['suspend', AgentsListingStatus.PUBLISHED, () => service.suspend(listingId, adminId, 'r')],
      ['unsuspend', AgentsListingStatus.SUSPENDED, () => service.unsuspend(listingId, adminId)],
    ] as const)('%s acquires SELECT FOR UPDATE before mutation', async (_name, from, run) => {
      listingStore = makeListing({ status: from, makerUserId: makerId });
      await run();
      expect(queryRawMock).toHaveBeenCalledTimes(1);
      const sqlFragments = queryRawMock.mock.calls[0][0] as readonly string[];
      const joined = sqlFragments.join(' ');
      expect(joined).toContain('FOR UPDATE');
      expect(joined).toContain('agents_listing');
    });
  });

  // ─── Counters / rating / soft-delete ─────────────────────────────

  describe('counters and rating', () => {
    it('incrementUserCount increments totalUsers by 1', async () => {
      await service.incrementUserCount(listingId);
      expect(agentsListingUpdate).toHaveBeenCalledWith({
        where: { id: listingId },
        data: { totalUsers: { increment: 1 } },
      });
    });

    it('incrementRunCount increments totalRuns by 1', async () => {
      await service.incrementRunCount(listingId);
      expect(agentsListingUpdate).toHaveBeenCalledWith({
        where: { id: listingId },
        data: { totalRuns: { increment: 1 } },
      });
    });

    it('softDelete sets deletedAt and audits', async () => {
      await service.softDelete(listingId, adminId);
      expect(agentsListingUpdate).toHaveBeenCalledWith({
        where: { id: listingId },
        data: { deletedAt: expect.any(Date) },
      });
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: adminId,
          payload: expect.objectContaining({ softDeleted: true }),
        }),
      );
    });
  });

  // ─── Phase 2C helpers ────────────────────────────────────────────

  describe('computeOwnership', () => {
    const userId = 200n;

    it('returns owns=false when no completed purchase exists', async () => {
      agentsPurchaseFindFirst.mockResolvedValueOnce(null);
      const result = await service.computeOwnership(listingId, userId, AgentsPricingType.ONE_TIME);
      expect(result).toEqual({ owns: false, runsRemaining: null });
      expect(agentsPurchaseFindFirst).toHaveBeenCalledWith({
        where: { userId, listingId, status: AgentsPurchaseStatus.COMPLETED },
        select: { id: true },
      });
    });

    it('returns owns=true when a completed purchase exists', async () => {
      agentsPurchaseFindFirst.mockResolvedValueOnce({ id: 99n });
      const result = await service.computeOwnership(listingId, userId, AgentsPricingType.ONE_TIME);
      expect(result.owns).toBe(true);
      // ONE_TIME → runsRemaining stays null
      expect(result.runsRemaining).toBeNull();
    });

    it('does not query agents_user_runs for non-PER_RUN listings', async () => {
      agentsPurchaseFindFirst.mockResolvedValueOnce({ id: 99n });
      await service.computeOwnership(listingId, userId, AgentsPricingType.FREE);
      expect(agentsUserRunsFindUnique).not.toHaveBeenCalled();
    });

    it('returns runsRemaining from agents_user_runs for PER_RUN listings', async () => {
      agentsPurchaseFindFirst.mockResolvedValueOnce({ id: 99n });
      agentsUserRunsFindUnique.mockResolvedValueOnce({ remainingRuns: 7n });
      const result = await service.computeOwnership(listingId, userId, AgentsPricingType.PER_RUN);
      expect(result).toEqual({ owns: true, runsRemaining: 7 });
      expect(agentsUserRunsFindUnique).toHaveBeenCalledWith({
        where: { userId_listingId: { userId, listingId } },
        select: { remainingRuns: true },
      });
    });

    it('returns runsRemaining=0 for PER_RUN listings with no user_runs row', async () => {
      agentsPurchaseFindFirst.mockResolvedValueOnce(null);
      agentsUserRunsFindUnique.mockResolvedValueOnce(null);
      const result = await service.computeOwnership(listingId, userId, AgentsPricingType.PER_RUN);
      expect(result).toEqual({ owns: false, runsRemaining: 0 });
    });
  });

  describe('computeRatingDistribution', () => {
    it('returns zeros for every rating bucket when no reviews exist', async () => {
      agentsReviewGroupBy.mockResolvedValueOnce([]);
      const dist = await service.computeRatingDistribution(listingId);
      expect(dist).toEqual({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 });
    });

    it('maps groupBy rows into the rating-keyed distribution', async () => {
      agentsReviewGroupBy.mockResolvedValueOnce([
        { rating: 5, _count: { _all: 3 } },
        { rating: 4, _count: { _all: 2 } },
        { rating: 1, _count: { _all: 1 } },
      ]);
      const dist = await service.computeRatingDistribution(listingId);
      expect(dist).toEqual({ '1': 1, '2': 0, '3': 0, '4': 2, '5': 3 });
    });

    it('queries with isHidden:false to exclude moderated reviews', async () => {
      await service.computeRatingDistribution(listingId);
      expect(agentsReviewGroupBy).toHaveBeenCalledWith({
        by: ['rating'],
        where: { listingId, isHidden: false },
        _count: { _all: true },
      });
    });
  });
});
