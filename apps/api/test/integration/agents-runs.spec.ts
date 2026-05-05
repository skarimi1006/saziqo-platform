import { createHash } from 'crypto';

import 'reflect-metadata';
import '../../src/common/bigint-serialization';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  AgentsListingStatus,
  AgentsPricingType,
  AgentsPurchaseStatus,
  AgentsRunOutcome,
} from '@prisma/client';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/core/prisma/prisma.service';
import { RedisService } from '../../src/core/redis/redis.service';
import { lowRunsDedupKey } from '../../src/modules/agents/services/runs.service';

// Integration test for Phase 3E — real Postgres + Redis required.
// The runs/consume endpoint authenticates with X-Agent-API-Key (not JWT)
// so we can call it with no Authorization header. Each test starts from
// a clean run-balance state for a deterministic threshold check.
describe('POST /api/v1/agents/runs/consume (Phase 3E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;

  let makerUserId: bigint;
  let buyerUserId: bigint;
  let categoryId: bigint;

  let listingId: bigint;
  let listingSlug: string;
  let perRunPackId: bigint;
  let apiKeyPlaintext: string;

  const MAKER_PHONE = '+989000099601';
  const BUYER_PHONE = '+989000099602';

  async function clearRunsState(): Promise<void> {
    await prisma.agents_user_runs.deleteMany({ where: { listingId } });
    // agents_run_event is append-only — leave rows in place; tests
    // scope their assertions by createdAt > a captured timestamp.
    await prisma.agents_listing.update({
      where: { id: listingId },
      data: { totalRuns: 0n },
    });
    await redis.getClient().del(lowRunsDedupKey(buyerUserId, listingId));
  }

  async function fullCleanup(): Promise<void> {
    await prisma.agents_user_runs.deleteMany({
      where: { listing: { makerUserId } },
    });
    await prisma.agents_purchase.deleteMany({
      where: { listing: { makerUserId } },
    });
    await prisma.agents_run_pack.deleteMany({
      where: { listing: { makerUserId } },
    });
    // agents_run_event is append-only (DB trigger blocks DELETE) and
    // FK-references the listing, so a hard DELETE on the listing
    // afterwards fails. Soft-delete instead — the setup creates a fresh
    // slug each run, so leftover rows do not collide.
    await prisma.agents_listing.updateMany({
      where: { makerUserId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    // Test users + audit_log rows intentionally left behind — see
    // agents-download.spec.ts for the same rationale.
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bufferLogs: false });
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);

    const maker = await prisma.user.upsert({
      where: { phone: MAKER_PHONE },
      create: { phone: MAKER_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'سازنده-ران' },
      update: {},
    });
    makerUserId = maker.id;

    const buyer = await prisma.user.upsert({
      where: { phone: BUYER_PHONE },
      create: { phone: BUYER_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'خریدار-ران' },
      update: {},
    });
    buyerUserId = buyer.id;

    // Reset listings/run state from any prior failed run. agents_run_event
    // is append-only and FK-references listings, so soft-delete instead
    // of hard delete on the listing rows.
    await prisma.agents_user_runs.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_purchase.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_run_pack.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_listing.updateMany({
      where: { makerUserId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    const cat = await prisma.agents_category.findFirst({ orderBy: { order: 'asc' } });
    categoryId = cat!.id;

    apiKeyPlaintext = `agk_${uuidv4()}`;
    const apiKeyHash = createHash('sha256').update(apiKeyPlaintext).digest('hex');

    const ts = Date.now();
    listingSlug = `runs-listing-${ts}`;
    listingId = (
      await prisma.agents_listing.create({
        data: {
          slug: listingSlug,
          titleFa: 'ایجنت اشتراکی اجرا',
          shortDescFa: 'تست اجرا',
          longDescFaMd: 'متن کامل',
          categoryId,
          makerUserId,
          pricingType: AgentsPricingType.PER_RUN,
          status: AgentsListingStatus.PUBLISHED,
          publishedAt: new Date(),
          apiKeyHash,
          apiKeyPreview: `...${apiKeyPlaintext.slice(-8)}`,
        },
      })
    ).id;

    perRunPackId = (
      await prisma.agents_run_pack.create({
        data: {
          listingId,
          nameFa: 'بسته ۱۰',
          runs: 10n,
          priceToman: 30_000n,
          order: 0,
          isActive: true,
        },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await fullCleanup();
    await app.close();
  }, 30_000);

  beforeEach(async () => {
    await clearRunsState();
  });

  it('valid key + sufficient runs → 200 with decrement and CONSUMED event', async () => {
    await prisma.agents_user_runs.create({
      data: {
        userId: buyerUserId,
        listingId,
        remainingRuns: 5n,
        totalGranted: 10n,
        totalConsumed: 5n,
      },
    });
    await prisma.agents_purchase.create({
      data: {
        userId: buyerUserId,
        listingId,
        pricingTypeAtSale: AgentsPricingType.PER_RUN,
        runPackId: perRunPackId,
        runsGranted: 10n,
        amountToman: 30_000n,
        commissionToman: 6_000n,
        makerEarnedToman: 24_000n,
        status: AgentsPurchaseStatus.COMPLETED,
      },
    });

    const before = new Date();
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/runs/consume')
      .set('X-Agent-API-Key', apiKeyPlaintext)
      .send({ listingSlug, userId: buyerUserId.toString() });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ remainingRuns: '4', totalConsumed: '6' });

    const runs = await prisma.agents_user_runs.findUnique({
      where: { userId_listingId: { userId: buyerUserId, listingId } },
    });
    expect(runs?.remainingRuns).toBe(4n);
    expect(runs?.totalConsumed).toBe(6n);
    expect(runs?.lastConsumedAt).not.toBeNull();

    const listing = await prisma.agents_listing.findUnique({ where: { id: listingId } });
    expect(listing?.totalRuns).toBe(1n);

    const event = await prisma.agents_run_event.findFirst({
      where: {
        userId: buyerUserId,
        listingId,
        outcome: AgentsRunOutcome.CONSUMED,
        createdAt: { gte: before },
      },
    });
    expect(event).not.toBeNull();
  });

  it('invalid key → 401 INVALID_API_KEY and REFUSED_INVALID_KEY event', async () => {
    await prisma.agents_user_runs.create({
      data: {
        userId: buyerUserId,
        listingId,
        remainingRuns: 5n,
        totalGranted: 10n,
      },
    });

    const before = new Date();
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/runs/consume')
      .set('X-Agent-API-Key', 'totally-wrong-key')
      .send({ listingSlug, userId: buyerUserId.toString() });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_API_KEY');

    const runs = await prisma.agents_user_runs.findUnique({
      where: { userId_listingId: { userId: buyerUserId, listingId } },
    });
    expect(runs?.remainingRuns).toBe(5n); // unchanged

    const event = await prisma.agents_run_event.findFirst({
      where: {
        userId: buyerUserId,
        listingId,
        outcome: AgentsRunOutcome.REFUSED_INVALID_KEY,
        createdAt: { gte: before },
      },
    });
    expect(event).not.toBeNull();
  });

  it('zero runs → 409 INSUFFICIENT_RUNS and REFUSED_INSUFFICIENT event', async () => {
    await prisma.agents_user_runs.create({
      data: {
        userId: buyerUserId,
        listingId,
        remainingRuns: 0n,
        totalGranted: 10n,
        totalConsumed: 10n,
      },
    });

    const before = new Date();
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/runs/consume')
      .set('X-Agent-API-Key', apiKeyPlaintext)
      .send({ listingSlug, userId: buyerUserId.toString() });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_RUNS');

    const event = await prisma.agents_run_event.findFirst({
      where: {
        userId: buyerUserId,
        listingId,
        outcome: AgentsRunOutcome.REFUSED_INSUFFICIENT,
        createdAt: { gte: before },
      },
    });
    expect(event).not.toBeNull();
  });

  it('user without any user_runs row gets INSUFFICIENT_RUNS', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/runs/consume')
      .set('X-Agent-API-Key', apiKeyPlaintext)
      .send({ listingSlug, userId: buyerUserId.toString() });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_RUNS');
  });

  it('concurrent consumes do not double-decrement past zero', async () => {
    await prisma.agents_user_runs.create({
      data: {
        userId: buyerUserId,
        listingId,
        remainingRuns: 1n,
        totalGranted: 10n,
        totalConsumed: 9n,
      },
    });
    await prisma.agents_purchase.create({
      data: {
        userId: buyerUserId,
        listingId,
        pricingTypeAtSale: AgentsPricingType.PER_RUN,
        runPackId: perRunPackId,
        runsGranted: 10n,
        amountToman: 30_000n,
        commissionToman: 6_000n,
        makerEarnedToman: 24_000n,
        status: AgentsPurchaseStatus.COMPLETED,
      },
    });

    const send = (): Promise<request.Response> =>
      request(app.getHttpServer())
        .post('/api/v1/agents/runs/consume')
        .set('X-Agent-API-Key', apiKeyPlaintext)
        .send({ listingSlug, userId: buyerUserId.toString() });

    const [r1, r2] = await Promise.all([send(), send()]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const runs = await prisma.agents_user_runs.findUnique({
      where: { userId_listingId: { userId: buyerUserId, listingId } },
    });
    expect(runs?.remainingRuns).toBe(0n);
    expect(runs?.totalConsumed).toBe(10n);
  }, 20_000);

  it('AGENTS_RUNS_LOW fires once per pack, AGENTS_RUNS_DEPLETED fires on zero', async () => {
    // 10-run pack already burned to 2 remaining → next consume drops to
    // 1, which is ≤ ceil(0.1 * 10) = 1 → low-runs fires.
    await prisma.agents_user_runs.create({
      data: {
        userId: buyerUserId,
        listingId,
        remainingRuns: 2n,
        totalGranted: 10n,
        totalConsumed: 8n,
      },
    });
    await prisma.agents_purchase.create({
      data: {
        userId: buyerUserId,
        listingId,
        pricingTypeAtSale: AgentsPricingType.PER_RUN,
        runPackId: perRunPackId,
        runsGranted: 10n,
        amountToman: 30_000n,
        commissionToman: 6_000n,
        makerEarnedToman: 24_000n,
        status: AgentsPurchaseStatus.COMPLETED,
      },
    });

    const before = new Date();

    // First consume: 2 → 1 (at threshold) → AGENTS_RUNS_LOW dispatched.
    let res = await request(app.getHttpServer())
      .post('/api/v1/agents/runs/consume')
      .set('X-Agent-API-Key', apiKeyPlaintext)
      .send({ listingSlug, userId: buyerUserId.toString() });
    expect(res.status).toBe(201);

    // Second consume: 1 → 0 → AGENTS_RUNS_DEPLETED dispatched. The
    // low-runs dedup is still active, so no second LOW notification.
    res = await request(app.getHttpServer())
      .post('/api/v1/agents/runs/consume')
      .set('X-Agent-API-Key', apiKeyPlaintext)
      .send({ listingSlug, userId: buyerUserId.toString() });
    expect(res.status).toBe(201);

    // Notifications are dispatched fire-and-forget — poll briefly.
    type NotifRow = Awaited<ReturnType<typeof prisma.notification.findMany>>;
    let lows: NotifRow = [];
    let depleteds: NotifRow = [];
    for (let i = 0; i < 30; i++) {
      [lows, depleteds] = await Promise.all([
        prisma.notification.findMany({
          where: {
            userId: buyerUserId,
            type: 'AGENTS_RUNS_LOW',
            createdAt: { gte: before },
          },
        }),
        prisma.notification.findMany({
          where: {
            userId: buyerUserId,
            type: 'AGENTS_RUNS_DEPLETED',
            createdAt: { gte: before },
          },
        }),
      ]);
      if (lows.length === 1 && depleteds.length === 1) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(lows).toHaveLength(1);
    expect(depleteds).toHaveLength(1);

    // Dedup key was claimed.
    const dedup = await redis.getClient().get(lowRunsDedupKey(buyerUserId, listingId));
    expect(dedup).toBe('1');
  });

  it('REFUSED_INVALID_KEY response when listing slug is unknown (no leak)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/runs/consume')
      .set('X-Agent-API-Key', apiKeyPlaintext)
      .send({ listingSlug: 'definitely-does-not-exist', userId: buyerUserId.toString() });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_API_KEY');
  });

  it('missing X-Agent-API-Key header → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/runs/consume')
      .send({ listingSlug, userId: buyerUserId.toString() });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_API_KEY');
  });
});
