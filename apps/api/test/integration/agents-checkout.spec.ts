import 'reflect-metadata';
import '../../src/common/bigint-serialization';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AgentsListingStatus, AgentsPricingType } from '@prisma/client';
import { SignJWT } from 'jose';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';

import { AppModule } from '../../src/app.module';
import { ConfigService } from '../../src/config/config.service';
import { PrismaService } from '../../src/core/prisma/prisma.service';

// Integration test for Phase 3B — real Postgres + Redis required.
// Sets up: maker user, buyer user, three listings (FREE / ONE_TIME /
// PER_RUN with one active pack). Each test starts from a clean cart.
describe('POST /api/v1/agents/checkout (Phase 3B)', () => {
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

  const MAKER_PHONE = '+989000099301';
  const BUYER_PHONE = '+989000099302';

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

  async function clearCheckoutState(): Promise<void> {
    await prisma.agents_user_runs.deleteMany({
      where: { listing: { makerUserId: { in: [makerUserId, buyerUserId] } } },
    });
    await prisma.agents_purchase.deleteMany({
      where: { listing: { makerUserId: { in: [makerUserId, buyerUserId] } } },
    });
    await prisma.agents_cart_item.deleteMany({
      where: { userId: { in: [buyerUserId, makerUserId] } },
    });
    await prisma.agents_listing.updateMany({
      where: { makerUserId },
      data: { totalUsers: 0n, status: AgentsListingStatus.PUBLISHED },
    });
  }

  async function fullCleanup(): Promise<void> {
    await prisma.agents_user_runs.deleteMany({
      where: { listing: { makerUserId: { in: [makerUserId, buyerUserId] } } },
    });
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
      create: { phone: MAKER_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'سازنده-چک' },
      update: {},
    });
    makerUserId = maker.id;

    const buyer = await prisma.user.upsert({
      where: { phone: BUYER_PHONE },
      create: { phone: BUYER_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'خریدار-چک' },
      update: {},
    });
    buyerUserId = buyer.id;

    await fullCleanup();

    const cat = await prisma.agents_category.findFirst({ orderBy: { order: 'asc' } });
    categoryId = cat!.id;

    const ts = Date.now();

    freeListingId = (
      await prisma.agents_listing.create({
        data: {
          slug: `checkout-free-${ts}`,
          titleFa: 'ایجنت رایگان چک‌اوت',
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
          slug: `checkout-onetime-${ts}`,
          titleFa: 'ایجنت یک‌بار چک‌اوت',
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
          slug: `checkout-perrun-${ts}`,
          titleFa: 'ایجنت اشتراکی چک‌اوت',
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
  }, 60_000);

  afterAll(async () => {
    await fullCleanup();
    await prisma.wallet.deleteMany({
      where: { userId: { in: [makerUserId, buyerUserId] } },
    });
    await prisma.user.deleteMany({
      where: { phone: { in: [MAKER_PHONE, BUYER_PHONE] } },
    });
    await app.close();
  }, 30_000);

  beforeEach(async () => {
    await clearCheckoutState();
  });

  it('checks out FREE + ONE_TIME + PER_RUN in a single transaction', async () => {
    await prisma.agents_cart_item.createMany({
      data: [
        { userId: buyerUserId, listingId: freeListingId },
        { userId: buyerUserId, listingId: oneTimeListingId },
        { userId: buyerUserId, listingId: perRunListingId, runPackId: perRunPackId },
      ],
    });

    const token = await signAccessToken(buyerUserId);
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/checkout')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `chk-${uuidv4()}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data.purchaseIds).toHaveLength(3);
    // FREE 0 + ONE_TIME 50_000 + PER_RUN 30_000 = 80_000
    expect(res.body.data.totalAmountToman).toBe('80000');

    const purchases = await prisma.agents_purchase.findMany({
      where: { userId: buyerUserId },
      orderBy: { id: 'asc' },
    });
    expect(purchases).toHaveLength(3);

    const byListing = new Map(purchases.map((p) => [p.listingId.toString(), p]));
    const freeP = byListing.get(freeListingId.toString())!;
    expect(freeP.amountToman).toBe(0n);
    expect(freeP.commissionToman).toBe(0n);
    expect(freeP.makerEarnedToman).toBe(0n);

    const oneP = byListing.get(oneTimeListingId.toString())!;
    expect(oneP.amountToman).toBe(50_000n);
    // 20% default commission
    expect(oneP.commissionToman).toBe(10_000n);
    expect(oneP.makerEarnedToman).toBe(40_000n);

    const runP = byListing.get(perRunListingId.toString())!;
    expect(runP.amountToman).toBe(30_000n);
    expect(runP.commissionToman).toBe(6_000n);
    expect(runP.makerEarnedToman).toBe(24_000n);
    expect(runP.runsGranted).toBe(10n);

    const runs = await prisma.agents_user_runs.findUnique({
      where: { userId_listingId: { userId: buyerUserId, listingId: perRunListingId } },
    });
    expect(runs?.remainingRuns).toBe(10n);
    expect(runs?.totalGranted).toBe(10n);

    const cartAfter = await prisma.agents_cart_item.findMany({ where: { userId: buyerUserId } });
    expect(cartAfter).toHaveLength(0);

    // totalUsers incremented exactly once per listing (first-time buyer).
    const listings = await prisma.agents_listing.findMany({
      where: { id: { in: [freeListingId, oneTimeListingId, perRunListingId] } },
    });
    for (const l of listings) {
      expect(l.totalUsers).toBe(1n);
    }
  });

  it('PER_RUN second checkout adds cumulative runs without bumping totalUsers', async () => {
    await prisma.agents_cart_item.create({
      data: { userId: buyerUserId, listingId: perRunListingId, runPackId: perRunPackId },
    });

    const token = await signAccessToken(buyerUserId);
    const r1 = await request(app.getHttpServer())
      .post('/api/v1/agents/checkout')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `chk-1-${uuidv4()}`)
      .send({});
    expect(r1.status).toBe(201);

    await prisma.agents_cart_item.create({
      data: { userId: buyerUserId, listingId: perRunListingId, runPackId: perRunPackId },
    });
    const r2 = await request(app.getHttpServer())
      .post('/api/v1/agents/checkout')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `chk-2-${uuidv4()}`)
      .send({});
    expect(r2.status).toBe(201);

    const runs = await prisma.agents_user_runs.findUnique({
      where: { userId_listingId: { userId: buyerUserId, listingId: perRunListingId } },
    });
    expect(runs?.remainingRuns).toBe(20n);
    expect(runs?.totalGranted).toBe(20n);

    const listing = await prisma.agents_listing.findUnique({ where: { id: perRunListingId } });
    expect(listing?.totalUsers).toBe(1n);
  });

  it('rolls back the entire checkout when a listing was suspended after add', async () => {
    await prisma.agents_cart_item.createMany({
      data: [
        { userId: buyerUserId, listingId: freeListingId },
        { userId: buyerUserId, listingId: oneTimeListingId },
      ],
    });

    // Maker (or admin) suspended the ONE_TIME listing between cart-add and checkout.
    await prisma.agents_listing.update({
      where: { id: oneTimeListingId },
      data: { status: AgentsListingStatus.SUSPENDED },
    });

    const token = await signAccessToken(buyerUserId);
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/checkout')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `chk-${uuidv4()}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CHECKOUT_VALIDATION_FAILED');
    expect(res.body.error.details.failures).toHaveLength(1);
    expect(res.body.error.details.failures[0].listingId).toBe(oneTimeListingId.toString());
    expect(res.body.error.details.failures[0].reason).toBe('LISTING_NOT_PURCHASABLE');

    // No purchases created — full rollback.
    const purchases = await prisma.agents_purchase.findMany({ where: { userId: buyerUserId } });
    expect(purchases).toHaveLength(0);
    // Cart is preserved so the user can fix and retry.
    const cart = await prisma.agents_cart_item.findMany({ where: { userId: buyerUserId } });
    expect(cart).toHaveLength(2);
  });

  it('returns 400 EMPTY_CART when there is nothing to check out', async () => {
    const token = await signAccessToken(buyerUserId);
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/checkout')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `chk-${uuidv4()}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMPTY_CART');
  });

  it('serializes concurrent checkouts on the same user (no double-grant)', async () => {
    await prisma.agents_cart_item.create({
      data: { userId: buyerUserId, listingId: oneTimeListingId },
    });

    const token = await signAccessToken(buyerUserId);
    // Both calls use distinct Idempotency-Keys so the interceptor does
    // not collapse them — the SERIALIZABLE+FOR UPDATE lock is what must
    // prevent double-purchase.
    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/agents/checkout')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', `race-1-${uuidv4()}`)
        .send({}),
      request(app.getHttpServer())
        .post('/api/v1/agents/checkout')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', `race-2-${uuidv4()}`)
        .send({}),
    ]);

    const statuses = [r1.status, r2.status].sort();
    // One succeeds; the other sees an empty cart (already drained).
    expect(statuses).toEqual([201, 400]);

    const purchases = await prisma.agents_purchase.findMany({
      where: { userId: buyerUserId, listingId: oneTimeListingId },
    });
    expect(purchases).toHaveLength(1);

    const listing = await prisma.agents_listing.findUnique({ where: { id: oneTimeListingId } });
    expect(listing?.totalUsers).toBe(1n);
  }, 20_000);
});
