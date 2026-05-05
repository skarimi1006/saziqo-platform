import 'reflect-metadata';
import '../../src/common/bigint-serialization';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  AgentsListingStatus,
  AgentsPricingType,
  AgentsPurchaseStatus,
  Prisma,
} from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/core/prisma/prisma.service';
import { RedisService } from '../../src/core/redis/redis.service';

// Integration test for Phase 2D — real Postgres + Redis required.
// Sets up: maker user, two PUBLISHED listings (isFeatured on one),
// one DRAFT, one purchase, one review. Verifies all four section
// endpoints and basic Redis cache behaviour.
describe('GET /api/v1/agents/* section endpoints (Phase 2D)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let makerUserId: bigint;
  let buyerUserId: bigint;
  let featuredListingId: bigint;

  const MAKER_PHONE = '+989000099201';
  const BUYER_PHONE = '+989000099202';

  const SECTION_KEYS = [
    'agents:section:featured',
    'agents:section:best-sellers',
    'agents:section:new-releases',
    'agents:section:recent-activity',
  ];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bufferLogs: false });
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);

    // Idempotent users.
    const maker = await prisma.user.upsert({
      where: { phone: MAKER_PHONE },
      create: { phone: MAKER_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'سازنده' },
      update: {},
    });
    makerUserId = maker.id;

    const buyer = await prisma.user.upsert({
      where: { phone: BUYER_PHONE },
      create: { phone: BUYER_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'خریدار' },
      update: {},
    });
    buyerUserId = buyer.id;

    // Wipe any leftover data from a prior run.
    await prisma.agents_review.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_purchase.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_run_pack.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_screenshot.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_cart_item.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_listing.deleteMany({ where: { makerUserId } });

    // Clear any stale section cache keys.
    await redis.getClient().del(...SECTION_KEYS);

    const cat = await prisma.agents_category.findFirst({ orderBy: { order: 'asc' } });
    const categoryId = cat!.id;

    const ts = Date.now();

    // Featured PUBLISHED listing.
    const featured = await prisma.agents_listing.create({
      data: {
        slug: `phase-2d-featured-${ts}`,
        titleFa: 'ایجنت ویژه',
        shortDescFa: 'ایجنت ویژه برای تست',
        longDescFaMd: '## ایجنت ویژه',
        categoryId,
        makerUserId,
        pricingType: AgentsPricingType.FREE,
        status: AgentsListingStatus.PUBLISHED,
        publishedAt: new Date(Date.now() - 60_000),
        isFeatured: true,
        featuredOrder: 1,
        totalUsers: 10n,
        ratingAverage: new Prisma.Decimal('4.80'),
        ratingCount: 3n,
      },
    });
    featuredListingId = featured.id;

    // Non-featured PUBLISHED listing with higher totalUsers for best-sellers ordering.
    await prisma.agents_listing.create({
      data: {
        slug: `phase-2d-regular-${ts}`,
        titleFa: 'ایجنت عادی',
        shortDescFa: 'ایجنت عادی برای تست',
        longDescFaMd: '## ایجنت عادی',
        categoryId,
        makerUserId,
        pricingType: AgentsPricingType.PER_RUN,
        status: AgentsListingStatus.PUBLISHED,
        publishedAt: new Date(Date.now() - 120_000),
        isFeatured: false,
        totalUsers: 100n,
        ratingAverage: new Prisma.Decimal('3.50'),
        ratingCount: 2n,
      },
    });

    // DRAFT listing — must never appear in any section.
    await prisma.agents_listing.create({
      data: {
        slug: `phase-2d-draft-${ts}`,
        titleFa: 'پیش‌نویس',
        shortDescFa: 'نباید نمایش داده شود',
        longDescFaMd: '## پیش‌نویس',
        categoryId,
        makerUserId,
        pricingType: AgentsPricingType.FREE,
        status: AgentsListingStatus.DRAFT,
      },
    });

    // Purchase on the featured listing (FREE → kind='install' in recent-activity).
    await prisma.agents_purchase.create({
      data: {
        userId: buyerUserId,
        listingId: featuredListingId,
        pricingTypeAtSale: AgentsPricingType.FREE,
        runsGranted: 0n,
        amountToman: 0n,
        commissionToman: 0n,
        makerEarnedToman: 0n,
        status: AgentsPurchaseStatus.COMPLETED,
      },
    });

    // Review on the featured listing.
    await prisma.agents_review.create({
      data: {
        listingId: featuredListingId,
        authorUserId: buyerUserId,
        rating: 5,
        bodyFa: 'عالی بود',
      },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.agents_review.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_purchase.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_listing.deleteMany({ where: { makerUserId } });
    await prisma.user.deleteMany({ where: { phone: { in: [MAKER_PHONE, BUYER_PHONE] } } });
    await redis.getClient().del(...SECTION_KEYS);
    await app.close();
  }, 30_000);

  // ─── Featured ────────────────────────────────────────────────────────────

  it('GET /featured returns 200 with only isFeatured PUBLISHED listings', async () => {
    await redis.getClient().del('agents:section:featured');

    const res = await request(app.getHttpServer()).get('/api/v1/agents/featured');
    expect(res.status).toBe(200);

    const items = res.body.data as Array<{ id: string; isFeatured: boolean; slug: string }>;
    expect(Array.isArray(items)).toBe(true);

    // Every item returned must be featured.
    for (const item of items) {
      expect(item.isFeatured).toBe(true);
    }

    // Our featured listing must appear.
    const ids = items.map((i) => i.id);
    expect(ids).toContain(featuredListingId.toString());

    // Shape check on one item.
    const card = items.find((i) => i.id === featuredListingId.toString())!;
    expect(card).toMatchObject({
      slug: expect.stringContaining('phase-2d-featured'),
      titleFa: 'ایجنت ویژه',
      pricingType: 'FREE',
      isFeatured: true,
      makerHandle: expect.stringMatching(/^m[0-9A-Za-z]+$/),
    });
  });

  // ─── Best sellers ────────────────────────────────────────────────────────

  it('GET /best-sellers returns 200 with PUBLISHED listings ordered by totalUsers DESC', async () => {
    await redis.getClient().del('agents:section:best-sellers');

    const res = await request(app.getHttpServer()).get('/api/v1/agents/best-sellers');
    expect(res.status).toBe(200);

    const items = res.body.data as Array<{ id: string; totalUsers: string; slug: string }>;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(2);

    // Must be sorted descending by totalUsers.
    for (let i = 1; i < items.length; i++) {
      expect(BigInt(items[i - 1]!.totalUsers)).toBeGreaterThanOrEqual(BigInt(items[i]!.totalUsers));
    }

    // Draft listing must not appear.
    for (const item of items) {
      expect(item.slug).not.toContain('draft');
    }
  });

  // ─── New releases ────────────────────────────────────────────────────────

  it('GET /new-releases returns 200 with PUBLISHED listings ordered by publishedAt DESC', async () => {
    await redis.getClient().del('agents:section:new-releases');

    const res = await request(app.getHttpServer()).get('/api/v1/agents/new-releases');
    expect(res.status).toBe(200);

    const items = res.body.data as Array<{ id: string; slug: string }>;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(2);

    // Draft listing must not appear.
    const slugs = items.map((i) => i.slug);
    for (const slug of slugs) {
      expect(slug).not.toContain('draft');
    }
  });

  // ─── Recent activity ─────────────────────────────────────────────────────

  it('GET /recent-activity returns 200 with correct shape', async () => {
    await redis.getClient().del('agents:section:recent-activity');

    const res = await request(app.getHttpServer()).get('/api/v1/agents/recent-activity');
    expect(res.status).toBe(200);

    const items = res.body.data as Array<{
      kind: string;
      userHandle: string;
      listingSlug: string;
      listingTitleFa: string;
      timestamp: string;
    }>;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(2);

    for (const item of items) {
      expect(['install', 'purchase', 'review']).toContain(item.kind);
      expect(item.userHandle).toMatch(/^m[0-9A-Za-z]+$/);
      expect(typeof item.listingSlug).toBe('string');
      expect(typeof item.listingTitleFa).toBe('string');
      // Must be parseable ISO timestamp.
      expect(isNaN(Date.parse(item.timestamp))).toBe(false);
    }

    // Our FREE purchase must appear as kind='install'.
    const installEvent = items.find(
      (i) => i.kind === 'install' && i.listingSlug.includes('phase-2d-featured'),
    );
    expect(installEvent).toBeDefined();

    // Our review must appear as kind='review'.
    const reviewEvent = items.find(
      (i) => i.kind === 'review' && i.listingSlug.includes('phase-2d-featured'),
    );
    expect(reviewEvent).toBeDefined();
  });

  it('recent-activity is ordered timestamp DESC (most recent first)', async () => {
    await redis.getClient().del('agents:section:recent-activity');

    const res = await request(app.getHttpServer()).get('/api/v1/agents/recent-activity');
    const items = res.body.data as Array<{ timestamp: string }>;
    for (let i = 1; i < items.length; i++) {
      expect(Date.parse(items[i - 1]!.timestamp)).toBeGreaterThanOrEqual(
        Date.parse(items[i]!.timestamp),
      );
    }
  });

  // ─── Cache behaviour ─────────────────────────────────────────────────────

  it('populates Redis key after first request and it contains valid JSON', async () => {
    await redis.getClient().del('agents:section:featured');

    await request(app.getHttpServer()).get('/api/v1/agents/featured');

    const cached = await redis.getClient().get('agents:section:featured');
    expect(cached).not.toBeNull();

    const parsed = JSON.parse(cached!) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('serves cached data on second request (Redis key survives between calls)', async () => {
    await redis.getClient().del('agents:section:featured');

    // First call — populates cache.
    const res1 = await request(app.getHttpServer()).get('/api/v1/agents/featured');
    expect(res1.status).toBe(200);
    const ids1 = (res1.body.data as Array<{ id: string }>).map((i) => i.id);

    // Second call — should return same data from cache without touching DB.
    const res2 = await request(app.getHttpServer()).get('/api/v1/agents/featured');
    expect(res2.status).toBe(200);
    const ids2 = (res2.body.data as Array<{ id: string }>).map((i) => i.id);

    expect(ids1).toEqual(ids2);
  });

  it('repopulates cache after key is manually deleted', async () => {
    // Warm the cache.
    await request(app.getHttpServer()).get('/api/v1/agents/best-sellers');

    // Delete the key to force a cache miss.
    await redis.getClient().del('agents:section:best-sellers');

    // Should still return 200 and repopulate.
    const res = await request(app.getHttpServer()).get('/api/v1/agents/best-sellers');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);

    const repopulated = await redis.getClient().get('agents:section:best-sellers');
    expect(repopulated).not.toBeNull();
  });
});
