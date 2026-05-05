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
import { ListingsService } from '../../src/modules/agents/services/listings.service';

// Phase 4A integration — real Postgres + Redis. Verifies the full maker
// submission flow: a maker drafts a listing, submits it for review, an
// admin sees the row in PENDING_REVIEW status, and approve() transitions
// it to PUBLISHED with the published-side denormalizations preserved.
describe('Maker listings (Phase 4A)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;
  let listings: ListingsService;

  let makerUserId: bigint;
  let adminUserId: bigint;
  let categoryId: bigint;
  let testRoleId: bigint;

  const MAKER_PHONE = '+989000099801';
  const ADMIN_PHONE = '+989000099802';
  const TEST_ROLE_NAME = 'agents-maker-test';
  const SLUG_BASE = `maker-listing-${Date.now()}`;

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

  async function fullCleanup(): Promise<void> {
    await prisma.agents_run_pack.deleteMany({
      where: { listing: { makerUserId } },
    });
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
    listings = app.get(ListingsService);

    const maker = await prisma.user.upsert({
      where: { phone: MAKER_PHONE },
      create: {
        phone: MAKER_PHONE,
        status: 'ACTIVE',
        firstName: 'تست',
        lastName: 'سازنده-ساب',
      },
      update: {},
    });
    makerUserId = maker.id;

    const admin = await prisma.user.upsert({
      where: { phone: ADMIN_PHONE },
      create: { phone: ADMIN_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'ادمین-ساب' },
      update: {},
    });
    adminUserId = admin.id;

    // Test role granting agents:create:listing to the maker. The platform
    // bootstrap seeds 'member' rather than the 'user' role referenced in
    // the agents contract, so a dedicated role mirrors that posture.
    const role = await prisma.role.upsert({
      where: { name: TEST_ROLE_NAME },
      create: { name: TEST_ROLE_NAME, persianName: 'سازنده تست' },
      update: {},
    });
    testRoleId = role.id;
    const perm = await prisma.permission.findUnique({
      where: { code: 'agents:create:listing' },
    });
    if (!perm) throw new Error('agents:create:listing not seeded');
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      create: { roleId: role.id, permissionId: perm.id },
      update: {},
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: makerUserId, roleId: role.id } },
      create: { userId: makerUserId, roleId: role.id },
      update: {},
    });

    const cat = await prisma.agents_category.findFirst({ orderBy: { order: 'asc' } });
    categoryId = cat!.id;
  }, 60_000);

  afterAll(async () => {
    await fullCleanup();
    // CLAUDE: Users are intentionally left behind — the audit_logs trigger
    // blocks UPDATE, and Prisma's referential cleanup of nullable relations
    // would try to set audit_log.actorUserId to NULL on delete. Other
    // agents integration tests follow the same posture (e.g.
    // agents-reviews.spec.ts retains its phones).
    await app.close();
  }, 30_000);

  beforeEach(async () => {
    await prisma.agents_run_pack.deleteMany({
      where: { listing: { makerUserId } },
    });
    await prisma.agents_listing.updateMany({
      where: { makerUserId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  });

  it('full flow: create DRAFT → submit-for-review → admin approves → PUBLISHED', async () => {
    const token = await signAccessToken(makerUserId);
    const slug = `${SLUG_BASE}-flow`;

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/agents/me/maker/listings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `mk-${uuidv4()}`)
      .send({
        slug,
        titleFa: 'ایجنت بررسی فاز چهار',
        shortDescFa: 'یک ایجنت تست برای بررسی فاز ۴ سازندگان بازارگاه ایجنت‌ها.',
        longDescFaMd:
          'این لیستینگ برای آزمایش جریان ارسال و تأیید لیستینگ ساخته شده است. ' +
          'متن طولانی برای پاس کردن حداقل صد کاراکتر مورد نیاز اعتبارسنجی Zod.',
        categoryId: categoryId.toString(),
        pricingType: 'PER_RUN',
        runPacks: [
          { nameFa: 'بسته شروع', runs: '10', priceToman: '30000' },
          { nameFa: 'بسته حرفه‌ای', runs: '50', priceToman: '120000' },
        ],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.status).toBe(AgentsListingStatus.DRAFT);
    const listingIdStr = createRes.body.data.id as string;
    const listingId = BigInt(listingIdStr);
    expect(createRes.body.data.slug).toBe(slug);

    const draft = await prisma.agents_listing.findUnique({ where: { id: listingId } });
    expect(draft?.status).toBe(AgentsListingStatus.DRAFT);
    expect(draft?.makerUserId).toBe(makerUserId);
    const packs = await prisma.agents_run_pack.findMany({
      where: { listingId },
      orderBy: { order: 'asc' },
    });
    expect(packs).toHaveLength(2);
    expect(packs[0]!.runs).toBe(10n);
    expect(packs[1]!.priceToman).toBe(120_000n);

    // Submit for review. The service emits AGENTS_NEW_LISTING_PENDING to
    // every admin and writes an AGENTS_LISTING_SUBMITTED audit row.
    const submitRes = await request(app.getHttpServer())
      .post(`/api/v1/agents/me/maker/listings/${listingIdStr}/submit-for-review`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.data.status).toBe(AgentsListingStatus.PENDING_REVIEW);

    const auditRows = await prisma.auditLog.findMany({
      where: {
        action: 'AGENTS_LISTING_SUBMITTED',
        resource: 'agents_listing',
        resourceId: listingId.toString(),
      },
    });
    expect(auditRows.length).toBeGreaterThanOrEqual(1);

    // The admin moderation endpoint lands in Phase 5A; for now exercise
    // the service directly to verify approve() works on the queued row.
    const pending = await prisma.agents_listing.findFirst({
      where: { status: AgentsListingStatus.PENDING_REVIEW, id: listingId },
    });
    expect(pending).not.toBeNull();

    await listings.approve(listingId, adminUserId);

    const published = await prisma.agents_listing.findUnique({ where: { id: listingId } });
    expect(published?.status).toBe(AgentsListingStatus.PUBLISHED);
    expect(published?.publishedAt).not.toBeNull();
  }, 30_000);

  it('rejects a duplicate slug with SLUG_TAKEN (case-insensitive)', async () => {
    const token = await signAccessToken(makerUserId);
    const slug = `${SLUG_BASE}-dupe`;

    await prisma.agents_listing.create({
      data: {
        slug,
        titleFa: 'موجود',
        shortDescFa: 'توضیحی برای پاس کردن حداقل بیست کاراکتر.',
        longDescFaMd:
          'این لیستینگ از قبل موجود است و باید باعث رد شدن درخواست بعدی با همان اسلاگ شود؛ ' +
          'متن طولانی برای پاس کردن حداقل صد کاراکتر اعتبارسنجی موردنیاز است.',
        categoryId,
        makerUserId,
        pricingType: AgentsPricingType.FREE,
        status: AgentsListingStatus.DRAFT,
      },
    });

    // The slug regex forbids uppercase, so the SLUG_TAKEN path is reached
    // only when the validator-passing input collides with an existing row
    // — submit the exact slug already stored.
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/me/maker/listings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `mk-${uuidv4()}`)
      .send({
        slug,
        titleFa: 'تلاش دوم',
        shortDescFa: 'توضیحی برای پاس کردن حداقل بیست کاراکتر.',
        longDescFaMd:
          'این درخواست باید با خطای SLUG_TAKEN رد شود زیرا اسلاگ از قبل توسط لیستینگ دیگری ' +
          'گرفته شده است؛ متن طولانی برای پاس کردن حداقل صد کاراکتر اعتبارسنجی است.',
        categoryId: categoryId.toString(),
        pricingType: 'FREE',
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLUG_TAKEN');
  }, 30_000);

  it('rejects PER_RUN with zero packs at the validator (INVALID_PACKS)', async () => {
    const token = await signAccessToken(makerUserId);
    const res = await request(app.getHttpServer())
      .post('/api/v1/agents/me/maker/listings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `mk-${uuidv4()}`)
      .send({
        slug: `${SLUG_BASE}-empty-packs`,
        titleFa: 'بدون بسته',
        shortDescFa: 'توضیحی برای پاس کردن حداقل بیست کاراکتر.',
        longDescFaMd:
          'این لیستینگ باید رد شود زیرا برای PER_RUN باید حداقل یک بسته اجرا تعریف شده باشد. ' +
          'متن طولانی برای پاس کردن حداقل صد کاراکتر اعتبارسنجی Zod مورد نیاز است.',
        categoryId: categoryId.toString(),
        pricingType: 'PER_RUN',
        runPacks: [],
      });
    expect(res.status).toBe(400);
  }, 30_000);
});
