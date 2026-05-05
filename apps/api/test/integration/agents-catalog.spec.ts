import 'reflect-metadata';
import '../../src/common/bigint-serialization';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AgentsListingStatus, AgentsPricingType, Prisma } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/core/prisma/prisma.service';

// Integration test — real Postgres required.
// Creates 30 published listings in beforeAll, runs catalog assertions, cleans up in afterAll.
//
// NOTE: cursor-based pagination is tested only for sort=most-installed where
// totalUsers is monotonically correlated with row ID, making id<cursor correct.
// For other sort modes the v1 id<cursor cursor is a known simplification.
describe('GET /api/v1/agents/catalog (Phase 2B)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let makerUserId: bigint;
  let categoryAId: bigint;
  let categoryBId: bigint;

  const TEST_PHONE = '+989000099042';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bufferLogs: false });
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = app.get(PrismaService);

    // Idempotent test maker — survive re-runs after a failed cleanup.
    const maker = await prisma.user.upsert({
      where: { phone: TEST_PHONE },
      create: { phone: TEST_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'کاتالوگ' },
      update: {},
    });
    makerUserId = maker.id;

    // Wipe any listings left from a previous failed run.
    await prisma.agents_listing.deleteMany({ where: { makerUserId } });

    // Use the first two seeded categories.
    const cats = await prisma.agents_category.findMany({
      orderBy: { order: 'asc' },
      take: 2,
    });
    categoryAId = cats[0]!.id;
    categoryBId = cats[1]!.id;

    // 30 published listings.
    // totalUsers = i+1  → item i=29 has the HIGHEST totalUsers AND the highest ID.
    // publishedAt       → i=29 is the MOST RECENT (Date.now()) so newest sort also
    //                     orders by descending ID, making id<cursor correct.
    // ratingAverage     → i=0..19: (i%5)+1; i=20..29: null (for NULLS LAST test).
    // pricingType       → i<10 FREE, 10<=i<20 ONE_TIME, 20<=i<30 PER_RUN.
    // category          → i<15 → A, 15<=i<30 → B.
    for (let i = 0; i < 30; i++) {
      await prisma.agents_listing.create({
        data: {
          slug: `catalog-test-${i}-${Date.now()}`,
          titleFa: `ایجنت کاتالوگ ${i}`,
          shortDescFa: `توضیح کوتاه ${i}`,
          longDescFaMd: 'متن کامل',
          categoryId: i < 15 ? categoryAId : categoryBId,
          makerUserId,
          pricingType:
            i < 10
              ? AgentsPricingType.FREE
              : i < 20
                ? AgentsPricingType.ONE_TIME
                : AgentsPricingType.PER_RUN,
          oneTimePriceToman: i >= 10 && i < 20 ? 10000n : null,
          status: AgentsListingStatus.PUBLISHED,
          publishedAt: new Date(Date.now() - (29 - i) * 60_000),
          ratingAverage: i < 20 ? new Prisma.Decimal((i % 5) + 1) : null,
          ratingCount: BigInt(i + 1),
          totalUsers: BigInt(i + 1),
        },
      });
    }
  }, 60_000);

  afterAll(async () => {
    await prisma.agents_listing.deleteMany({ where: { makerUserId } });
    await prisma.wallet.deleteMany({ where: { userId: makerUserId } });
    await prisma.user.delete({ where: { id: makerUserId } });
    await app.close();
  }, 30_000);

  // ─── Shape ────────────────────────────────────────────────────────────

  it('returns the correct ListingCardDto shape', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/agents/catalog?limit=1');
    expect(res.status).toBe(200);
    const item = res.body.data[0] as Record<string, unknown>;
    expect(item).toMatchObject({
      id: expect.any(String),
      slug: expect.any(String),
      titleFa: expect.any(String),
      shortDescFa: expect.any(String),
      categoryId: expect.any(String),
      categoryNameFa: expect.any(String),
      makerHandle: expect.stringMatching(/^m[0-9A-Za-z]+$/),
      pricingType: expect.any(String),
      isFeatured: expect.any(Boolean),
      totalUsers: expect.any(String),
      totalRuns: expect.any(String),
      ratingCount: expect.any(String),
    });
    expect(res.body.meta).toMatchObject({
      nextCursor: expect.any(String),
      hasMore: true,
    });
    expect('primaryScreenshotUrl' in item).toBe(true);
  });

  // ─── Pagination ───────────────────────────────────────────────────────

  it('returns 20 items by default with hasMore=true', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/v1/agents/catalog?sort=most-installed',
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(20);
    expect(res.body.meta.hasMore).toBe(true);
    expect(res.body.meta.nextCursor).toBeTruthy();
  });

  it('respects the limit parameter', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/agents/catalog?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.meta.hasMore).toBe(true);
  });

  it('paginates through all 30 items without duplicates (sort=most-installed)', async () => {
    const server = app.getHttpServer();
    const allIds: string[] = [];

    // Page 1
    const p1 = await request(server).get('/api/v1/agents/catalog?sort=most-installed&limit=10');
    expect(p1.status).toBe(200);
    expect(p1.body.data).toHaveLength(10);
    expect(p1.body.meta.hasMore).toBe(true);
    allIds.push(...(p1.body.data as Array<{ id: string }>).map((d) => d.id));

    // Page 2
    const p2 = await request(server).get(
      `/api/v1/agents/catalog?sort=most-installed&limit=10&cursor=${p1.body.meta.nextCursor as string}`,
    );
    expect(p2.status).toBe(200);
    expect(p2.body.data).toHaveLength(10);
    expect(p2.body.meta.hasMore).toBe(true);
    allIds.push(...(p2.body.data as Array<{ id: string }>).map((d) => d.id));

    // Page 3 (last)
    const p3 = await request(server).get(
      `/api/v1/agents/catalog?sort=most-installed&limit=10&cursor=${p2.body.meta.nextCursor as string}`,
    );
    expect(p3.status).toBe(200);
    expect(p3.body.data).toHaveLength(10);
    expect(p3.body.meta.hasMore).toBe(false);
    expect(p3.body.meta.nextCursor).toBeNull();
    allIds.push(...(p3.body.data as Array<{ id: string }>).map((d) => d.id));

    // 30 total, no duplicates
    expect(allIds).toHaveLength(30);
    expect(new Set(allIds).size).toBe(30);
  });

  // ─── Filters ──────────────────────────────────────────────────────────

  it('filters by pricingType=FREE', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/agents/catalog?pricingType=FREE');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.meta.hasMore).toBe(false);
    for (const item of res.body.data as Array<{ pricingType: string }>) {
      expect(item.pricingType).toBe('FREE');
    }
  });

  it('freeOnly=true equals pricingType=FREE', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/agents/catalog?freeOnly=true');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    for (const item of res.body.data as Array<{ pricingType: string }>) {
      expect(item.pricingType).toBe('FREE');
    }
  });

  it('filters by categoryId', async () => {
    const res = await request(app.getHttpServer()).get(
      `/api/v1/agents/catalog?categoryId=${categoryAId.toString()}&limit=20`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(15); // 15 in category A
    expect(res.body.meta.hasMore).toBe(false);
    for (const item of res.body.data as Array<{ categoryId: string }>) {
      expect(item.categoryId).toBe(categoryAId.toString());
    }
  });

  it('filters by minRating', async () => {
    // ratingAverage >= 4: items where (i%5)+1 >= 4, i.e. i%5=3 or i%5=4
    // from i=0..19: i=3,4,8,9,13,14,18,19 → 8 items
    const res = await request(app.getHttpServer()).get('/api/v1/agents/catalog?minRating=4');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(8);
    for (const item of res.body.data as Array<{ ratingAverage: string }>) {
      expect(parseFloat(item.ratingAverage)).toBeGreaterThanOrEqual(4);
    }
  });

  // ─── Sort ─────────────────────────────────────────────────────────────

  it('sort=newest returns items with most-recent publishedAt first', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/v1/agents/catalog?sort=newest&limit=5',
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    // Items are ordered i=29..25 by publishedAt DESC which correlates with
    // totalUsers 30..26 — verify descending totalUsers as a proxy.
    const totals = (res.body.data as Array<{ totalUsers: string }>).map((d) =>
      parseInt(d.totalUsers),
    );
    for (let i = 1; i < totals.length; i++) {
      expect(totals[i]).toBeLessThan(totals[i - 1]!);
    }
  });

  it('sort=top-rated places rated items before unrated items (NULLS LAST)', async () => {
    // i=0..19 have ratingAverage; i=20..29 have null.
    // First 20 results for top-rated should all have non-null ratingAverage.
    const res = await request(app.getHttpServer()).get(
      '/api/v1/agents/catalog?sort=top-rated&limit=20',
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(20);
    for (const item of res.body.data as Array<{ ratingAverage: string | null }>) {
      expect(item.ratingAverage).not.toBeNull();
    }
  });

  it('sort=most-installed returns highest totalUsers first', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/v1/agents/catalog?sort=most-installed&limit=5',
    );
    expect(res.status).toBe(200);
    const totals = (res.body.data as Array<{ totalUsers: string }>).map((d) =>
      parseInt(d.totalUsers),
    );
    for (let i = 1; i < totals.length; i++) {
      expect(totals[i]).toBeLessThan(totals[i - 1]!);
    }
  });

  // ─── Edge cases ───────────────────────────────────────────────────────

  it('returns empty data with hasMore=false when no items match filters', async () => {
    // No listing has pricingType=PER_RUN AND minRating=5 among our data
    // (PER_RUN items are i=20..29 which all have null ratingAverage).
    const res = await request(app.getHttpServer()).get(
      '/api/v1/agents/catalog?pricingType=PER_RUN&minRating=5',
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.hasMore).toBe(false);
    expect(res.body.meta.nextCursor).toBeNull();
  });

  it('rejects invalid sort value with 400', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/agents/catalog?sort=invalid');
    expect(res.status).toBe(400);
  });

  it('rejects limit > 50 with 400', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/agents/catalog?limit=51');
    expect(res.status).toBe(400);
  });
});
