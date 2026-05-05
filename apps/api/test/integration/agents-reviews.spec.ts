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

// Integration test for Phase 3F — real Postgres required.
// agents:review:owned permission is granted via a dedicated test role
// (the platform bootstrap seeds `member`, not the `user` role the
// agents contract references — same posture as agents-library.spec.ts).
describe('Reviews endpoints (Phase 3F)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;

  let makerUserId: bigint;
  let buyerAUserId: bigint;
  let buyerBUserId: bigint;
  let outsiderUserId: bigint;
  let categoryId: bigint;
  let testRoleId: bigint;

  let listingId: bigint;

  const MAKER_PHONE = '+989000099701';
  const BUYER_A_PHONE = '+989000099702';
  const BUYER_B_PHONE = '+989000099703';
  const OUTSIDER_PHONE = '+989000099704';
  const TEST_ROLE_NAME = 'agents-reviews-test-buyer';

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

  async function clearReviewsState(): Promise<void> {
    await prisma.agents_review.deleteMany({ where: { listingId } });
    await prisma.agents_listing.update({
      where: { id: listingId },
      data: { ratingAverage: null, ratingCount: 0n },
    });
  }

  async function fullCleanup(): Promise<void> {
    await prisma.agents_review.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_purchase.deleteMany({ where: { listing: { makerUserId } } });
    // Soft-delete listing — agents_run_event is append-only and may
    // FK-reference the listing if other tests ran first.
    await prisma.agents_listing.updateMany({
      where: { makerUserId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
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
      create: { phone: MAKER_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'سازنده-ریو' },
      update: {},
    });
    makerUserId = maker.id;

    const buyerA = await prisma.user.upsert({
      where: { phone: BUYER_A_PHONE },
      create: { phone: BUYER_A_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'الف' },
      update: {},
    });
    buyerAUserId = buyerA.id;

    const buyerB = await prisma.user.upsert({
      where: { phone: BUYER_B_PHONE },
      create: { phone: BUYER_B_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'ب' },
      update: {},
    });
    buyerBUserId = buyerB.id;

    const outsider = await prisma.user.upsert({
      where: { phone: OUTSIDER_PHONE },
      create: { phone: OUTSIDER_PHONE, status: 'ACTIVE' },
      update: {},
    });
    outsiderUserId = outsider.id;

    // Test-only role with agents:review:owned permission.
    const role = await prisma.role.upsert({
      where: { name: TEST_ROLE_NAME },
      create: { name: TEST_ROLE_NAME, persianName: 'بازخوردگذار تست' },
      update: {},
    });
    testRoleId = role.id;
    const perm = await prisma.permission.findUnique({
      where: { code: 'agents:review:owned' },
    });
    if (!perm) throw new Error('agents:review:owned not seeded');
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      create: { roleId: role.id, permissionId: perm.id },
      update: {},
    });
    for (const userId of [buyerAUserId, buyerBUserId, outsiderUserId]) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId, roleId: role.id } },
        create: { userId, roleId: role.id },
        update: {},
      });
    }

    // Wipe leftover state.
    await prisma.agents_review.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_purchase.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_listing.updateMany({
      where: { makerUserId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    const cat = await prisma.agents_category.findFirst({ orderBy: { order: 'asc' } });
    categoryId = cat!.id;

    const ts = Date.now();
    listingId = (
      await prisma.agents_listing.create({
        data: {
          slug: `reviews-${ts}`,
          titleFa: 'ایجنت بازخورد',
          shortDescFa: 'تست',
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

    // Both buyers own the listing; outsider does not.
    for (const userId of [buyerAUserId, buyerBUserId]) {
      await prisma.agents_purchase.create({
        data: {
          userId,
          listingId,
          pricingTypeAtSale: AgentsPricingType.ONE_TIME,
          amountToman: 50_000n,
          commissionToman: 10_000n,
          makerEarnedToman: 40_000n,
          status: AgentsPurchaseStatus.COMPLETED,
        },
      });
    }
  }, 60_000);

  afterAll(async () => {
    await fullCleanup();
    await app.close();
  }, 30_000);

  beforeEach(async () => {
    await clearReviewsState();
  });

  it('owner posts a review → 201, rating recomputed, maker notified', async () => {
    const before = new Date();
    const token = await signAccessToken(buyerAUserId);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/agents/me/library/${listingId.toString()}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rating: 5, bodyFa: 'بسیار عالی' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      listingId: listingId.toString(),
      authorUserId: buyerAUserId.toString(),
      rating: 5,
      bodyFa: 'بسیار عالی',
      isHidden: false,
    });

    const listing = await prisma.agents_listing.findUnique({ where: { id: listingId } });
    expect(listing?.ratingCount).toBe(1n);
    expect(listing?.ratingAverage?.toString()).toBe('5');

    // First review → AGENTS_REVIEW_POSTED notification to the maker.
    type NotifRow = Awaited<ReturnType<typeof prisma.notification.findMany>>;
    let notifs: NotifRow = [];
    for (let i = 0; i < 30 && notifs.length === 0; i++) {
      notifs = await prisma.notification.findMany({
        where: {
          userId: makerUserId,
          type: 'AGENTS_REVIEW_POSTED',
          createdAt: { gte: before },
        },
      });
      if (notifs.length === 0) await new Promise((r) => setTimeout(r, 50));
    }
    expect(notifs).toHaveLength(1);
  });

  it('non-owner cannot post → 403 ACCESS_DENIED_NOT_OWNER', async () => {
    const token = await signAccessToken(outsiderUserId);
    const res = await request(app.getHttpServer())
      .post(`/api/v1/agents/me/library/${listingId.toString()}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rating: 4, bodyFa: 'هرگز نخریدم' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCESS_DENIED_NOT_OWNER');
    const listing = await prisma.agents_listing.findUnique({ where: { id: listingId } });
    expect(listing?.ratingCount).toBe(0n);
  });

  it('rating outside 1-5 is rejected at validation', async () => {
    const token = await signAccessToken(buyerAUserId);
    const tooHigh = await request(app.getHttpServer())
      .post(`/api/v1/agents/me/library/${listingId.toString()}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rating: 6 });
    expect(tooHigh.status).toBe(400);

    const tooLow = await request(app.getHttpServer())
      .post(`/api/v1/agents/me/library/${listingId.toString()}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rating: 0 });
    expect(tooLow.status).toBe(400);
  });

  it('aggregates ratings across two buyers and excludes hidden reviews', async () => {
    const tokenA = await signAccessToken(buyerAUserId);
    const tokenB = await signAccessToken(buyerBUserId);
    await request(app.getHttpServer())
      .post(`/api/v1/agents/me/library/${listingId.toString()}/review`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ rating: 5 });
    await request(app.getHttpServer())
      .post(`/api/v1/agents/me/library/${listingId.toString()}/review`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ rating: 3 });

    let listing = await prisma.agents_listing.findUnique({ where: { id: listingId } });
    expect(listing?.ratingCount).toBe(2n);
    expect(parseFloat(listing!.ratingAverage!.toString())).toBeCloseTo(4.0, 2);

    // Hide buyer B's review — recompute should drop it from average + count.
    await prisma.agents_review.updateMany({
      where: { listingId, authorUserId: buyerBUserId },
      data: { isHidden: true, hiddenReason: 'spam' },
    });
    // Rating recomputation only fires on user-driven review mutations,
    // so simulate by triggering an edit on buyer A.
    await request(app.getHttpServer())
      .patch(`/api/v1/agents/me/library/${listingId.toString()}/review`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ rating: 5 });

    listing = await prisma.agents_listing.findUnique({ where: { id: listingId } });
    expect(listing?.ratingCount).toBe(1n);
    expect(listing?.ratingAverage?.toString()).toBe('5');
  });

  it('PATCH edits rating and body in place', async () => {
    const token = await signAccessToken(buyerAUserId);
    await request(app.getHttpServer())
      .post(`/api/v1/agents/me/library/${listingId.toString()}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rating: 4, bodyFa: 'خوب' });

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/agents/me/library/${listingId.toString()}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rating: 2, bodyFa: 'متاسفانه افت کرد' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ rating: 2, bodyFa: 'متاسفانه افت کرد' });

    const listing = await prisma.agents_listing.findUnique({ where: { id: listingId } });
    expect(listing?.ratingCount).toBe(1n);
    expect(listing?.ratingAverage?.toString()).toBe('2');

    const reviews = await prisma.agents_review.findMany({
      where: { listingId, authorUserId: buyerAUserId },
    });
    expect(reviews).toHaveLength(1); // edits do not create extra rows
  });

  it('PATCH on missing review → 404', async () => {
    const token = await signAccessToken(buyerAUserId);
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/agents/me/library/${listingId.toString()}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rating: 5 });
    expect(res.status).toBe(404);
  });

  it('DELETE removes review and recomputes rating', async () => {
    const token = await signAccessToken(buyerAUserId);
    await request(app.getHttpServer())
      .post(`/api/v1/agents/me/library/${listingId.toString()}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rating: 5 });

    let listing = await prisma.agents_listing.findUnique({ where: { id: listingId } });
    expect(listing?.ratingCount).toBe(1n);

    const res = await request(app.getHttpServer())
      .delete(`/api/v1/agents/me/library/${listingId.toString()}/review`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);

    listing = await prisma.agents_listing.findUnique({ where: { id: listingId } });
    expect(listing?.ratingCount).toBe(0n);
    expect(listing?.ratingAverage).toBeNull();
  });

  it('one-per-buyer enforcement: a second POST upserts (no second row)', async () => {
    const token = await signAccessToken(buyerAUserId);
    await request(app.getHttpServer())
      .post(`/api/v1/agents/me/library/${listingId.toString()}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rating: 5 });
    await request(app.getHttpServer())
      .post(`/api/v1/agents/me/library/${listingId.toString()}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rating: 1, bodyFa: 'بازنگری' });

    const reviews = await prisma.agents_review.findMany({
      where: { listingId, authorUserId: buyerAUserId },
    });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.rating).toBe(1);

    const listing = await prisma.agents_listing.findUnique({ where: { id: listingId } });
    expect(listing?.ratingCount).toBe(1n);
    expect(listing?.ratingAverage?.toString()).toBe('1');
  });

  it('audit row written for review POST', async () => {
    const token = await signAccessToken(buyerAUserId);
    const before = new Date();
    const res = await request(app.getHttpServer())
      .post(`/api/v1/agents/me/library/${listingId.toString()}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rating: 5, bodyFa: 'تست ممیزی' });
    expect(res.status).toBe(201);

    let audit: Awaited<ReturnType<typeof prisma.auditLog.findFirst>> = null;
    for (let i = 0; i < 20 && audit === null; i++) {
      audit = await prisma.auditLog.findFirst({
        where: {
          action: 'AGENTS_REVIEW_POSTED',
          actorUserId: buyerAUserId,
          resourceId: listingId.toString(),
          createdAt: { gte: before },
        },
      });
      if (audit === null) await new Promise((r) => setTimeout(r, 50));
    }
    expect(audit).not.toBeNull();
  });
});
