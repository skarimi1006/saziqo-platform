import 'reflect-metadata';
import '../../src/common/bigint-serialization';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AgentsListingStatus, AgentsPricingType, AgentsPurchaseStatus } from '@prisma/client';
import { SignJWT } from 'jose';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';

import { AppModule } from '../../src/app.module';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/core/prisma/prisma.service';

// Integration test for Phase 3A — real Postgres + Redis required.
// Scenario: an anonymous user has 5 candidate items in localStorage. After
// login, /cart/merge is called with all of them. The buyer already owns
// one ONE_TIME listing (filtered as ALREADY_OWNED) and one item is the
// buyer's own listing (filtered as CANNOT_BUY_OWN_LISTING). The remaining
// three — a FREE listing, a ONE_TIME listing, and a PER_RUN listing with
// a valid pack — must end up in the DB cart.
describe('POST /api/v1/agents/cart/merge (Phase 3A)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;

  let makerUserId: bigint;
  let buyerUserId: bigint;
  let categoryId: bigint;

  let freeListingId: bigint;
  let oneTimeListingId: bigint;
  let perRunListingId: bigint;
  let perRunPackId: bigint;
  let alreadyOwnedListingId: bigint;
  let buyerOwnListingId: bigint;
  let pendingListingId: bigint;

  const MAKER_PHONE = '+989000099201';
  const BUYER_PHONE = '+989000099202';

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

  async function cleanup(): Promise<void> {
    await prisma.agents_purchase.deleteMany({
      where: { listing: { makerUserId: { in: [makerUserId, buyerUserId] } } },
    });
    await prisma.agents_cart_item.deleteMany({
      where: { userId: { in: [buyerUserId, makerUserId] } },
    });
    await prisma.agents_run_pack.deleteMany({
      where: { listing: { makerUserId: { in: [makerUserId, buyerUserId] } } },
    });
    await prisma.agents_listing.deleteMany({
      where: { makerUserId: { in: [makerUserId, buyerUserId] } },
    });
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

    const maker = await prisma.user.upsert({
      where: { phone: MAKER_PHONE },
      create: { phone: MAKER_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'سازنده-سبد' },
      update: {},
    });
    makerUserId = maker.id;

    const buyer = await prisma.user.upsert({
      where: { phone: BUYER_PHONE },
      create: { phone: BUYER_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'خریدار-سبد' },
      update: {},
    });
    buyerUserId = buyer.id;

    await cleanup();

    const cat = await prisma.agents_category.findFirst({ orderBy: { order: 'asc' } });
    categoryId = cat!.id;

    const ts = Date.now();

    freeListingId = (
      await prisma.agents_listing.create({
        data: {
          slug: `cart-free-${ts}`,
          titleFa: 'ایجنت رایگان سبد',
          shortDescFa: 'تست',
          longDescFaMd: 'متن',
          categoryId,
          makerUserId,
          pricingType: AgentsPricingType.FREE,
          status: AgentsListingStatus.PUBLISHED,
          publishedAt: new Date(),
        },
      })
    ).id;

    oneTimeListingId = (
      await prisma.agents_listing.create({
        data: {
          slug: `cart-onetime-${ts}`,
          titleFa: 'ایجنت یک‌بار سبد',
          shortDescFa: 'تست',
          longDescFaMd: 'متن',
          categoryId,
          makerUserId,
          pricingType: AgentsPricingType.ONE_TIME,
          oneTimePriceToman: 50_000n,
          status: AgentsListingStatus.PUBLISHED,
          publishedAt: new Date(),
        },
      })
    ).id;

    perRunListingId = (
      await prisma.agents_listing.create({
        data: {
          slug: `cart-perrun-${ts}`,
          titleFa: 'ایجنت اشتراکی سبد',
          shortDescFa: 'تست',
          longDescFaMd: 'متن',
          categoryId,
          makerUserId,
          pricingType: AgentsPricingType.PER_RUN,
          status: AgentsListingStatus.PUBLISHED,
          publishedAt: new Date(),
        },
      })
    ).id;

    perRunPackId = (
      await prisma.agents_run_pack.create({
        data: {
          listingId: perRunListingId,
          nameFa: 'بسته ۱۰',
          runs: 10n,
          priceToman: 30_000n,
          order: 0,
          isActive: true,
        },
      })
    ).id;

    // Already-owned ONE_TIME listing (buyer has a COMPLETED purchase).
    alreadyOwnedListingId = (
      await prisma.agents_listing.create({
        data: {
          slug: `cart-owned-${ts}`,
          titleFa: 'ایجنت قبلاً خریداری‌شده',
          shortDescFa: 'تست',
          longDescFaMd: 'متن',
          categoryId,
          makerUserId,
          pricingType: AgentsPricingType.ONE_TIME,
          oneTimePriceToman: 20_000n,
          status: AgentsListingStatus.PUBLISHED,
          publishedAt: new Date(),
        },
      })
    ).id;
    await prisma.agents_purchase.create({
      data: {
        userId: buyerUserId,
        listingId: alreadyOwnedListingId,
        pricingTypeAtSale: AgentsPricingType.ONE_TIME,
        amountToman: 20_000n,
        commissionToman: 4_000n,
        makerEarnedToman: 16_000n,
        status: AgentsPurchaseStatus.COMPLETED,
      },
    });

    // Listing owned by the buyer (they cannot buy their own).
    buyerOwnListingId = (
      await prisma.agents_listing.create({
        data: {
          slug: `cart-self-${ts}`,
          titleFa: 'ایجنت خود خریدار',
          shortDescFa: 'تست',
          longDescFaMd: 'متن',
          categoryId,
          makerUserId: buyerUserId,
          pricingType: AgentsPricingType.FREE,
          status: AgentsListingStatus.PUBLISHED,
          publishedAt: new Date(),
        },
      })
    ).id;

    // PENDING_REVIEW listing — not purchasable.
    pendingListingId = (
      await prisma.agents_listing.create({
        data: {
          slug: `cart-pending-${ts}`,
          titleFa: 'ایجنت در انتظار بررسی',
          shortDescFa: 'تست',
          longDescFaMd: 'متن',
          categoryId,
          makerUserId,
          pricingType: AgentsPricingType.FREE,
          status: AgentsListingStatus.PENDING_REVIEW,
        },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    await prisma.wallet.deleteMany({
      where: { userId: { in: [makerUserId, buyerUserId] } },
    });
    await prisma.user.deleteMany({
      where: { phone: { in: [MAKER_PHONE, BUYER_PHONE] } },
    });
    await app.close();
  }, 30_000);

  it('merges 3 valid items and surfaces ownership/self/pending failures', async () => {
    const token = await signAccessToken(buyerUserId);
    const guestCart = [
      { listingId: freeListingId.toString() },
      { listingId: oneTimeListingId.toString() },
      { listingId: perRunListingId.toString(), runPackId: perRunPackId.toString() },
      { listingId: alreadyOwnedListingId.toString() },
      { listingId: buyerOwnListingId.toString() },
      { listingId: pendingListingId.toString() },
    ];

    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/cart/merge')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `merge-${uuidv4()}`)
      .send({ items: guestCart });

    expect(res.status).toBe(201);
    expect(res.body.data.merged).toBe(3);
    expect(res.body.data.failed).toHaveLength(3);

    const reasonsByListing = new Map<string, string>(
      (res.body.data.failed as Array<{ listingId: string; reason: string }>).map((f) => [
        f.listingId,
        f.reason,
      ]),
    );
    expect(reasonsByListing.get(alreadyOwnedListingId.toString())).toBe('ALREADY_OWNED');
    expect(reasonsByListing.get(buyerOwnListingId.toString())).toBe('CANNOT_BUY_OWN_LISTING');
    expect(reasonsByListing.get(pendingListingId.toString())).toBe('LISTING_NOT_PURCHASABLE');

    // The 3 successful items should now exist in the DB cart.
    const dbItems = await prisma.agents_cart_item.findMany({
      where: { userId: buyerUserId },
      orderBy: { listingId: 'asc' },
    });
    expect(dbItems).toHaveLength(3);
    const listingIds = new Set(dbItems.map((i) => i.listingId.toString()));
    expect(listingIds.has(freeListingId.toString())).toBe(true);
    expect(listingIds.has(oneTimeListingId.toString())).toBe(true);
    expect(listingIds.has(perRunListingId.toString())).toBe(true);

    // GET /cart should return the same 3 lines via the aggregator.
    const getRes = await request(app.getHttpServer())
      .get('/api/v1/agents/cart')
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data).toHaveLength(3);
  });

  it('addItem rejects PER_RUN without a pack', async () => {
    await prisma.agents_cart_item.deleteMany({ where: { userId: buyerUserId } });
    const token = await signAccessToken(buyerUserId);
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/cart')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `add-${uuidv4()}`)
      .send({ listingId: perRunListingId.toString() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_RUN_PACK');
  });

  it('removeItem deletes only the caller’s row', async () => {
    await prisma.agents_cart_item.deleteMany({ where: { userId: buyerUserId } });
    const item = await prisma.agents_cart_item.create({
      data: { userId: buyerUserId, listingId: freeListingId, runPackId: null },
    });
    const token = await signAccessToken(buyerUserId);
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/agents/cart/${item.id.toString()}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `del-${uuidv4()}`);
    expect(res.status).toBe(204);
    const remaining = await prisma.agents_cart_item.findUnique({ where: { id: item.id } });
    expect(remaining).toBeNull();
  });
});
