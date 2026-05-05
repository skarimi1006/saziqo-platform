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

// Integration test for Phase 3C — real Postgres required.
// The library endpoints are gated by `agents:read:catalog`, which the
// agents contract links to the `user` role. The platform bootstrap
// seeds `member` (not `user`), so this test creates a dedicated test
// role and grants the buyer the permission directly. That keeps the
// global seed surface untouched.
describe('GET /api/v1/agents/me/library (Phase 3C)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;

  let makerUserId: bigint;
  let buyerUserId: bigint;
  let outsiderUserId: bigint;
  let categoryId: bigint;
  let testRoleId: bigint;

  let oneTimeListingId: bigint;
  let perRunListingId: bigint;
  let perRunPackId: bigint;
  let freeListingId: bigint;

  const MAKER_PHONE = '+989000099401';
  const BUYER_PHONE = '+989000099402';
  const OUTSIDER_PHONE = '+989000099403';
  const TEST_ROLE_NAME = 'agents-library-test-buyer';

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

  async function clearPurchases(): Promise<void> {
    await prisma.agents_user_runs.deleteMany({
      where: { listing: { makerUserId } },
    });
    await prisma.agents_purchase.deleteMany({
      where: { listing: { makerUserId } },
    });
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
    await prisma.agents_listing.deleteMany({ where: { makerUserId } });
    await prisma.userRole.deleteMany({ where: { roleId: testRoleId } });
    await prisma.rolePermission.deleteMany({ where: { roleId: testRoleId } });
    await prisma.role.deleteMany({ where: { id: testRoleId } });
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
      create: { phone: MAKER_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'سازنده-لیب' },
      update: {},
    });
    makerUserId = maker.id;

    const buyer = await prisma.user.upsert({
      where: { phone: BUYER_PHONE },
      create: { phone: BUYER_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'خریدار-لیب' },
      update: {},
    });
    buyerUserId = buyer.id;

    const outsider = await prisma.user.upsert({
      where: { phone: OUTSIDER_PHONE },
      create: { phone: OUTSIDER_PHONE, status: 'ACTIVE' },
      update: {},
    });
    outsiderUserId = outsider.id;

    // Test-only role + permission link for agents:read:catalog.
    const role = await prisma.role.upsert({
      where: { name: TEST_ROLE_NAME },
      create: { name: TEST_ROLE_NAME, persianName: 'خریدار تست' },
      update: {},
    });
    testRoleId = role.id;
    const perm = await prisma.permission.findUnique({
      where: { code: 'agents:read:catalog' },
    });
    if (!perm) throw new Error('agents:read:catalog not seeded');
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      create: { roleId: role.id, permissionId: perm.id },
      update: {},
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: buyerUserId, roleId: role.id } },
      create: { userId: buyerUserId, roleId: role.id },
      update: {},
    });

    // Wipe leftovers.
    await clearPurchases();
    await prisma.agents_run_pack.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_listing.deleteMany({ where: { makerUserId } });

    const cat = await prisma.agents_category.findFirst({ orderBy: { order: 'asc' } });
    categoryId = cat!.id;

    const ts = Date.now();

    oneTimeListingId = (
      await prisma.agents_listing.create({
        data: {
          slug: `lib-onetime-${ts}`,
          titleFa: 'ایجنت یک‌بار کتابخانه',
          shortDescFa: 'یک ایجنت',
          longDescFaMd: 'متن کامل',
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
          slug: `lib-perrun-${ts}`,
          titleFa: 'ایجنت اشتراکی کتابخانه',
          shortDescFa: 'اشتراکی',
          longDescFaMd: 'متن کامل',
          installInstructionsFaMd: 'دستور نصب',
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

    freeListingId = (
      await prisma.agents_listing.create({
        data: {
          slug: `lib-free-${ts}`,
          titleFa: 'ایجنت رایگان کتابخانه',
          shortDescFa: 'رایگان',
          longDescFaMd: 'متن کامل',
          categoryId,
          makerUserId,
          pricingType: AgentsPricingType.FREE,
          status: AgentsListingStatus.PUBLISHED,
          publishedAt: new Date(),
        },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await fullCleanup();
    await prisma.wallet.deleteMany({
      where: { userId: { in: [makerUserId, buyerUserId, outsiderUserId] } },
    });
    await prisma.user.deleteMany({
      where: { phone: { in: [MAKER_PHONE, BUYER_PHONE, OUTSIDER_PHONE] } },
    });
    await app.close();
  }, 30_000);

  beforeEach(async () => {
    await clearPurchases();
  });

  it('returns 1 row after a single ONE_TIME purchase', async () => {
    await prisma.agents_purchase.create({
      data: {
        userId: buyerUserId,
        listingId: oneTimeListingId,
        pricingTypeAtSale: AgentsPricingType.ONE_TIME,
        amountToman: 50_000n,
        commissionToman: 10_000n,
        makerEarnedToman: 40_000n,
        status: AgentsPurchaseStatus.COMPLETED,
      },
    });

    const token = await signAccessToken(buyerUserId);
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/library')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const row = res.body.data[0];
    expect(row).toMatchObject({
      listingId: oneTimeListingId.toString(),
      pricingType: 'ONE_TIME',
      runsRemaining: null,
      totalRuns: '0',
    });
    expect(row.ownedSince).toEqual(expect.any(String));
    expect(row.latestPurchaseDate).toEqual(expect.any(String));
    // SECURITY: commission and makerEarned must never appear in the response.
    expect(row).not.toHaveProperty('commissionToman');
    expect(row).not.toHaveProperty('makerEarnedToman');
  });

  it('collapses 2 PER_RUN pack purchases into 1 row with summed runs', async () => {
    await prisma.agents_purchase.create({
      data: {
        userId: buyerUserId,
        listingId: perRunListingId,
        pricingTypeAtSale: AgentsPricingType.PER_RUN,
        runPackId: perRunPackId,
        runsGranted: 10n,
        amountToman: 30_000n,
        commissionToman: 6_000n,
        makerEarnedToman: 24_000n,
        status: AgentsPurchaseStatus.COMPLETED,
      },
    });
    await prisma.agents_purchase.create({
      data: {
        userId: buyerUserId,
        listingId: perRunListingId,
        pricingTypeAtSale: AgentsPricingType.PER_RUN,
        runPackId: perRunPackId,
        runsGranted: 10n,
        amountToman: 30_000n,
        commissionToman: 6_000n,
        makerEarnedToman: 24_000n,
        status: AgentsPurchaseStatus.COMPLETED,
      },
    });
    await prisma.agents_user_runs.create({
      data: {
        userId: buyerUserId,
        listingId: perRunListingId,
        remainingRuns: 17n, // 20 granted minus 3 already consumed
        totalGranted: 20n,
        totalConsumed: 3n,
      },
    });

    const token = await signAccessToken(buyerUserId);
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/library')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      listingId: perRunListingId.toString(),
      pricingType: 'PER_RUN',
      runsRemaining: '17',
      totalRuns: '20',
    });
  });

  it('returns 3 rows when buyer owns 3 different listings, ordered latest-first', async () => {
    const earliest = new Date(Date.now() - 3 * 60_000);
    const middle = new Date(Date.now() - 2 * 60_000);
    const latest = new Date(Date.now() - 1 * 60_000);

    await prisma.agents_purchase.create({
      data: {
        userId: buyerUserId,
        listingId: freeListingId,
        pricingTypeAtSale: AgentsPricingType.FREE,
        amountToman: 0n,
        commissionToman: 0n,
        makerEarnedToman: 0n,
        status: AgentsPurchaseStatus.COMPLETED,
        createdAt: earliest,
      },
    });
    await prisma.agents_purchase.create({
      data: {
        userId: buyerUserId,
        listingId: oneTimeListingId,
        pricingTypeAtSale: AgentsPricingType.ONE_TIME,
        amountToman: 50_000n,
        commissionToman: 10_000n,
        makerEarnedToman: 40_000n,
        status: AgentsPurchaseStatus.COMPLETED,
        createdAt: middle,
      },
    });
    await prisma.agents_purchase.create({
      data: {
        userId: buyerUserId,
        listingId: perRunListingId,
        pricingTypeAtSale: AgentsPricingType.PER_RUN,
        runPackId: perRunPackId,
        runsGranted: 10n,
        amountToman: 30_000n,
        commissionToman: 6_000n,
        makerEarnedToman: 24_000n,
        status: AgentsPurchaseStatus.COMPLETED,
        createdAt: latest,
      },
    });
    await prisma.agents_user_runs.create({
      data: {
        userId: buyerUserId,
        listingId: perRunListingId,
        remainingRuns: 10n,
        totalGranted: 10n,
      },
    });

    const token = await signAccessToken(buyerUserId);
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/library')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    // Ordered by latest purchase DESC: PER_RUN, ONE_TIME, FREE.
    expect(res.body.data.map((r: { listingId: string }) => r.listingId)).toEqual([
      perRunListingId.toString(),
      oneTimeListingId.toString(),
      freeListingId.toString(),
    ]);
  });

  it('detail endpoint returns purchase history and sanitizes economics', async () => {
    await prisma.agents_purchase.create({
      data: {
        userId: buyerUserId,
        listingId: perRunListingId,
        pricingTypeAtSale: AgentsPricingType.PER_RUN,
        runPackId: perRunPackId,
        runsGranted: 10n,
        amountToman: 30_000n,
        commissionToman: 6_000n,
        makerEarnedToman: 24_000n,
        status: AgentsPurchaseStatus.COMPLETED,
      },
    });
    await prisma.agents_user_runs.create({
      data: {
        userId: buyerUserId,
        listingId: perRunListingId,
        remainingRuns: 10n,
        totalGranted: 10n,
      },
    });

    const token = await signAccessToken(buyerUserId);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agents/me/library/${perRunListingId.toString()}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      listingId: perRunListingId.toString(),
      pricingType: 'PER_RUN',
      runsRemaining: '10',
      totalRuns: '10',
      totalConsumed: '0',
      installInstructionsFaMd: 'دستور نصب',
    });
    expect(res.body.data.purchases).toHaveLength(1);
    expect(res.body.data.purchases[0]).toMatchObject({
      pricingTypeAtSale: 'PER_RUN',
      amountToman: '30000',
      runsGranted: '10',
      status: 'COMPLETED',
    });
    // SECURITY: economics never exposed.
    for (const p of res.body.data.purchases) {
      expect(p).not.toHaveProperty('commissionToman');
      expect(p).not.toHaveProperty('makerEarnedToman');
    }
  });

  it('detail endpoint 404s for a listing the buyer does not own', async () => {
    const token = await signAccessToken(buyerUserId);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agents/me/library/${oneTimeListingId.toString()}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('returns 403 for an authenticated user without agents:read:catalog', async () => {
    const token = await signAccessToken(outsiderUserId);
    const res = await request(app.getHttpServer())
      .get('/api/v1/agents/me/library')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('returns 401 for an unauthenticated request', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/agents/me/library');
    expect(res.status).toBe(401);
  });
});
