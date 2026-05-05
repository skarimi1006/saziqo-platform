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
import { SignJWT } from 'jose';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';

import { AppModule } from '../../src/app.module';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/core/prisma/prisma.service';

// Integration test for Phase 2C — real Postgres required.
// Sets up: maker user, two buyer users (one purchaser, one not), and one
// PUBLISHED PER_RUN listing wired up with screenshots, run packs, reviews,
// purchase, and a user_runs row. Plus a DRAFT listing for the 404 case.
describe('GET /api/v1/agents/listings/:slug (Phase 2C)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;
  let makerUserId: bigint;
  let buyerUserId: bigint;
  let nonBuyerUserId: bigint;
  let publishedListingId: bigint;
  let publishedSlug: string;
  let draftSlug: string;

  const MAKER_PHONE = '+989000099101';
  const BUYER_PHONE = '+989000099102';
  const NON_BUYER_PHONE = '+989000099103';

  // Sign an access token compatible with OptionalJwtAuthGuard (same payload
  // shape as SessionsService.signAccessToken — sub-only, HS256).
  async function signAccessToken(userId: bigint): Promise<string> {
    const secret = new TextEncoder().encode(config.get('JWT_SECRET'));
    return new SignJWT({ type: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(userId))
      .setJti(uuidv4())
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(secret);
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bufferLogs: false });
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = app.get(PrismaService);
    config = app.get(ConfigService);

    // Idempotent users (survive a failed prior run).
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

    const nonBuyer = await prisma.user.upsert({
      where: { phone: NON_BUYER_PHONE },
      create: { phone: NON_BUYER_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'بدون-خرید' },
      update: {},
    });
    nonBuyerUserId = nonBuyer.id;

    // Wipe leftovers from a prior run.
    await prisma.agents_run_event.deleteMany({
      where: { listing: { makerUserId } },
    });
    await prisma.agents_user_runs.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_purchase.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_review.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_run_pack.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_screenshot.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_cart_item.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_listing.deleteMany({ where: { makerUserId } });
    await prisma.file.deleteMany({ where: { ownerUserId: makerUserId } });

    const cat = await prisma.agents_category.findFirst({ orderBy: { order: 'asc' } });
    const categoryId = cat!.id;

    publishedSlug = `phase-2c-published-${Date.now()}`;
    draftSlug = `phase-2c-draft-${Date.now()}`;

    const published = await prisma.agents_listing.create({
      data: {
        slug: publishedSlug,
        titleFa: 'ایجنت تست جزئیات',
        shortDescFa: 'ایجنت برای تست صفحه جزئیات',
        longDescFaMd: '## درباره\n\nاین یک ایجنت تستی است.',
        installInstructionsFaMd: 'دستورالعمل نصب: گام ۱، گام ۲',
        categoryId,
        makerUserId,
        pricingType: AgentsPricingType.PER_RUN,
        oneTimePriceToman: null,
        status: AgentsListingStatus.PUBLISHED,
        publishedAt: new Date(),
        ratingAverage: new Prisma.Decimal('4.50'),
        ratingCount: 4n,
        totalUsers: 5n,
        totalRuns: 100n,
      },
    });
    publishedListingId = published.id;

    await prisma.agents_listing.create({
      data: {
        slug: draftSlug,
        titleFa: 'پیش‌نویس',
        shortDescFa: 'این لیستینگ هنوز منتشر نشده',
        longDescFaMd: 'متن کامل',
        categoryId,
        makerUserId,
        pricingType: AgentsPricingType.FREE,
        status: AgentsListingStatus.DRAFT,
      },
    });

    // Two screenshots — verify they appear in order.
    const file1 = await prisma.file.create({
      data: {
        ownerUserId: makerUserId,
        path: `tests/phase-2c-shot-1-${Date.now()}.png`,
        originalName: 'shot1.png',
        mimeType: 'image/png',
        size: 1024n,
        sha256: `phase2c-shot1-${Date.now()}-${Math.random()}`.padEnd(64, '0').slice(0, 64),
      },
    });
    const file2 = await prisma.file.create({
      data: {
        ownerUserId: makerUserId,
        path: `tests/phase-2c-shot-2-${Date.now()}.png`,
        originalName: 'shot2.png',
        mimeType: 'image/png',
        size: 2048n,
        sha256: `phase2c-shot2-${Date.now()}-${Math.random()}`.padEnd(64, '0').slice(0, 64),
      },
    });
    await prisma.agents_screenshot.create({
      data: { listingId: publishedListingId, fileId: file1.id, order: 0, altTextFa: 'تصویر اول' },
    });
    await prisma.agents_screenshot.create({
      data: { listingId: publishedListingId, fileId: file2.id, order: 1, altTextFa: 'تصویر دوم' },
    });

    // Two run packs — only the active one should appear.
    await prisma.agents_run_pack.create({
      data: {
        listingId: publishedListingId,
        nameFa: 'بسته ۱۰ اجرا',
        runs: 10n,
        priceToman: 50_000n,
        order: 0,
        isActive: true,
      },
    });
    await prisma.agents_run_pack.create({
      data: {
        listingId: publishedListingId,
        nameFa: 'بسته قدیمی',
        runs: 5n,
        priceToman: 25_000n,
        order: 1,
        isActive: false,
      },
    });

    // Reviews — three visible (rating 5, 4, 4) and one hidden (rating 1).
    await prisma.agents_review.create({
      data: { listingId: publishedListingId, authorUserId: buyerUserId, rating: 5, bodyFa: 'عالی' },
    });
    await prisma.agents_review.create({
      data: {
        listingId: publishedListingId,
        authorUserId: nonBuyerUserId,
        rating: 4,
        bodyFa: 'خوب',
      },
    });
    await prisma.agents_review.create({
      data: { listingId: publishedListingId, authorUserId: makerUserId, rating: 4, bodyFa: 'تست' },
    });
    // 4th review by another fresh user since (listingId, authorUserId) is unique.
    const extraUser = await prisma.user.upsert({
      where: { phone: '+989000099104' },
      create: { phone: '+989000099104', status: 'ACTIVE' },
      update: {},
    });
    await prisma.agents_review.create({
      data: {
        listingId: publishedListingId,
        authorUserId: extraUser.id,
        rating: 1,
        bodyFa: 'بد',
        isHidden: true,
        hiddenReason: 'spam',
      },
    });

    // Purchase + user_runs row for the buyer.
    await prisma.agents_purchase.create({
      data: {
        userId: buyerUserId,
        listingId: publishedListingId,
        pricingTypeAtSale: AgentsPricingType.PER_RUN,
        runsGranted: 10n,
        amountToman: 50_000n,
        commissionToman: 10_000n,
        makerEarnedToman: 40_000n,
        status: AgentsPurchaseStatus.COMPLETED,
      },
    });
    await prisma.agents_user_runs.create({
      data: {
        userId: buyerUserId,
        listingId: publishedListingId,
        remainingRuns: 7n,
        totalGranted: 10n,
        totalConsumed: 3n,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.agents_run_event.deleteMany({
      where: { listing: { makerUserId } },
    });
    await prisma.agents_user_runs.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_purchase.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_review.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_run_pack.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_screenshot.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_cart_item.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_listing.deleteMany({ where: { makerUserId } });
    await prisma.file.deleteMany({ where: { ownerUserId: makerUserId } });
    await prisma.wallet.deleteMany({
      where: { userId: { in: [makerUserId, buyerUserId, nonBuyerUserId] } },
    });
    await prisma.user.deleteMany({
      where: {
        phone: {
          in: [MAKER_PHONE, BUYER_PHONE, NON_BUYER_PHONE, '+989000099104'],
        },
      },
    });
    await app.close();
  }, 30_000);

  // ─── Happy path / shape ──────────────────────────────────────────────

  it('returns 200 with the full ListingDetailDto shape (anonymous)', async () => {
    const res = await request(app.getHttpServer()).get(`/api/v1/agents/listings/${publishedSlug}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d).toMatchObject({
      id: publishedListingId.toString(),
      slug: publishedSlug,
      titleFa: 'ایجنت تست جزئیات',
      pricingType: 'PER_RUN',
      isFeatured: false,
      categoryNameFa: expect.any(String),
      categorySlug: expect.any(String),
      ratingCount: '4',
      totalUsers: '5',
      totalRuns: '100',
    });
    expect(d.maker).toMatchObject({
      handle: expect.stringMatching(/^m[0-9A-Za-z]+$/),
      totalListings: 1, // only the published one counts
      joinedAt: expect.any(String),
    });
    expect(d.publishedAt).toEqual(expect.any(String));
    expect(d.ratingAverage).toBe('4.5');
    expect(d.ownership).toBeNull();
  });

  it('orders screenshots by order asc and returns download URLs', async () => {
    const res = await request(app.getHttpServer()).get(`/api/v1/agents/listings/${publishedSlug}`);
    const shots = res.body.data.screenshots as Array<{
      altTextFa: string;
      order: number;
      url: string;
    }>;
    expect(shots).toHaveLength(2);
    expect(shots[0]!.order).toBe(0);
    expect(shots[0]!.altTextFa).toBe('تصویر اول');
    expect(shots[1]!.order).toBe(1);
    expect(shots[0]!.url).toMatch(/^\/api\/v1\/files\/\d+\/download$/);
  });

  it('returns only active run packs ordered by order asc', async () => {
    const res = await request(app.getHttpServer()).get(`/api/v1/agents/listings/${publishedSlug}`);
    const packs = res.body.data.runPacks as Array<{ nameFa: string; runs: string }>;
    expect(packs).toHaveLength(1);
    expect(packs[0]!.nameFa).toBe('بسته ۱۰ اجرا');
    expect(packs[0]!.runs).toBe('10');
  });

  it('returns visible reviews (excludes hidden) with ratings + author handles', async () => {
    const res = await request(app.getHttpServer()).get(`/api/v1/agents/listings/${publishedSlug}`);
    const reviews = res.body.data.reviews as Array<{ rating: number; authorHandle: string }>;
    expect(reviews).toHaveLength(3);
    for (const r of reviews) {
      expect([4, 5]).toContain(r.rating);
      expect(r.authorHandle).toMatch(/^m[0-9A-Za-z]+$/);
    }
    expect(res.body.data.reviewCount).toBe(3);
  });

  it('rating distribution counts only non-hidden reviews', async () => {
    const res = await request(app.getHttpServer()).get(`/api/v1/agents/listings/${publishedSlug}`);
    expect(res.body.data.ratingDistribution).toEqual({
      '1': 0, // the hidden 1-star review must be excluded
      '2': 0,
      '3': 0,
      '4': 2,
      '5': 1,
    });
  });

  // ─── Ownership ───────────────────────────────────────────────────────

  it('returns ownership: null for anonymous request', async () => {
    const res = await request(app.getHttpServer()).get(`/api/v1/agents/listings/${publishedSlug}`);
    expect(res.body.data.ownership).toBeNull();
  });

  it('returns ownership: { owns: true, runsRemaining } for the buyer', async () => {
    const token = await signAccessToken(buyerUserId);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agents/listings/${publishedSlug}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.ownership).toEqual({ owns: true, runsRemaining: 7 });
  });

  it('returns ownership: { owns: false, runsRemaining: 0 } for an authenticated non-buyer (PER_RUN)', async () => {
    const token = await signAccessToken(nonBuyerUserId);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agents/listings/${publishedSlug}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.ownership).toEqual({ owns: false, runsRemaining: 0 });
  });

  it('treats a malformed Bearer token as anonymous (does not 401)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agents/listings/${publishedSlug}`)
      .set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(200);
    expect(res.body.data.ownership).toBeNull();
  });

  // ─── 404 paths ───────────────────────────────────────────────────────

  it('returns 404 for a DRAFT listing slug', async () => {
    const res = await request(app.getHttpServer()).get(`/api/v1/agents/listings/${draftSlug}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LISTING_NOT_FOUND');
  });

  it('returns 404 for a non-existent slug', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/v1/agents/listings/this-does-not-exist',
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LISTING_NOT_FOUND');
  });
});
