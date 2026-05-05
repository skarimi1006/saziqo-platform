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
import { LocalFileStore } from '../../src/core/files/local-file-store';
import { PrismaService } from '../../src/core/prisma/prisma.service';

// Integration test for Phase 3D — real Postgres + Redis + on-disk file
// store required. Uploads a real bundle through LocalFileStore so the
// download endpoint streams the bytes back through the wire.
describe('GET /api/v1/agents/me/library/:listingId/download (Phase 3D)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;
  let fileStore: LocalFileStore;

  let makerUserId: bigint;
  let buyerUserId: bigint;
  let outsiderUserId: bigint;
  let categoryId: bigint;

  let listingWithBundleId: bigint;
  let listingNoBundleId: bigint;
  let bundleFileId: bigint;
  let bundleBuffer: Buffer;
  let storedPath: string;

  const MAKER_PHONE = '+989000099501';
  const BUYER_PHONE = '+989000099502';
  const OUTSIDER_PHONE = '+989000099503';

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
    await prisma.agents_purchase.deleteMany({
      where: { listing: { makerUserId } },
    });
  }

  async function fullCleanup(): Promise<void> {
    await prisma.agents_purchase.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_listing.deleteMany({ where: { makerUserId } });
    await prisma.file.deleteMany({ where: { ownerUserId: makerUserId } });
    if (storedPath) {
      try {
        await fileStore.delete(storedPath);
      } catch {
        // Already gone — ignore.
      }
    }
    // Test users (and their wallets) are intentionally NOT deleted — the
    // @Audit interceptor leaves audit_log rows pointing at them, and
    // audit_logs is append-only (no DELETE / no UPDATE), so a User delete
    // would fail the FK SET NULL. The setup upserts by phone, so leaving
    // these rows behind is fully idempotent across re-runs.
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
    fileStore = app.get(LocalFileStore);

    const maker = await prisma.user.upsert({
      where: { phone: MAKER_PHONE },
      create: { phone: MAKER_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'سازنده-دلود' },
      update: {},
    });
    makerUserId = maker.id;

    const buyer = await prisma.user.upsert({
      where: { phone: BUYER_PHONE },
      create: { phone: BUYER_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'خریدار-دلود' },
      update: {},
    });
    buyerUserId = buyer.id;

    const outsider = await prisma.user.upsert({
      where: { phone: OUTSIDER_PHONE },
      create: { phone: OUTSIDER_PHONE, status: 'ACTIVE' },
      update: {},
    });
    outsiderUserId = outsider.id;

    await prisma.agents_purchase.deleteMany({ where: { listing: { makerUserId } } });
    await prisma.agents_listing.deleteMany({ where: { makerUserId } });
    await prisma.file.deleteMany({ where: { ownerUserId: makerUserId } });

    const cat = await prisma.agents_category.findFirst({ orderBy: { order: 'asc' } });
    categoryId = cat!.id;

    // Create a real on-disk bundle through LocalFileStore so the
    // download path streams actual bytes.
    bundleBuffer = Buffer.from('PKFAKE-AGENT-BUNDLE-CONTENTS-' + uuidv4(), 'utf8');
    const stored = await fileStore.put({
      buffer: bundleBuffer,
      originalName: 'agent-bundle.zip',
      mimeType: 'application/zip',
      ownerUserId: makerUserId,
    });
    storedPath = stored.path;
    const file = await prisma.file.create({
      data: {
        ownerUserId: makerUserId,
        path: stored.path,
        originalName: 'agent-bundle.zip',
        mimeType: stored.mimeType,
        size: BigInt(stored.size),
        sha256: stored.sha256,
      },
    });
    bundleFileId = file.id;

    const ts = Date.now();

    listingWithBundleId = (
      await prisma.agents_listing.create({
        data: {
          slug: `download-with-bundle-${ts}`,
          titleFa: 'ایجنت دانلودی',
          shortDescFa: 'تست دانلود',
          longDescFaMd: 'متن کامل',
          categoryId,
          makerUserId,
          pricingType: AgentsPricingType.ONE_TIME,
          oneTimePriceToman: 50_000n,
          status: AgentsListingStatus.PUBLISHED,
          publishedAt: new Date(),
          bundleFileId,
        },
      })
    ).id;

    listingNoBundleId = (
      await prisma.agents_listing.create({
        data: {
          slug: `download-no-bundle-${ts}`,
          titleFa: 'ایجنت بدون فایل',
          shortDescFa: 'بدون فایل',
          longDescFaMd: 'متن کامل',
          categoryId,
          makerUserId,
          pricingType: AgentsPricingType.FREE,
          status: AgentsListingStatus.PUBLISHED,
          publishedAt: new Date(),
          bundleFileId: null,
        },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await fullCleanup();
    await app.close();
  }, 30_000);

  beforeEach(async () => {
    await clearPurchases();
  });

  it('owner downloads bundle: 200 with correct bytes and Content-Disposition', async () => {
    await prisma.agents_purchase.create({
      data: {
        userId: buyerUserId,
        listingId: listingWithBundleId,
        pricingTypeAtSale: AgentsPricingType.ONE_TIME,
        amountToman: 50_000n,
        commissionToman: 10_000n,
        makerEarnedToman: 40_000n,
        status: AgentsPurchaseStatus.COMPLETED,
      },
    });

    const token = await signAccessToken(buyerUserId);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agents/me/library/${listingWithBundleId.toString()}/download`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((response, cb) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain('attachment');
    // Filename hint uses the listing slug, not the original upload name.
    expect(res.headers['content-disposition']).toContain('download-with-bundle-');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).equals(bundleBuffer)).toBe(true);
  });

  it('non-owner gets 403 ACCESS_DENIED_NOT_OWNER', async () => {
    const token = await signAccessToken(outsiderUserId);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agents/me/library/${listingWithBundleId.toString()}/download`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCESS_DENIED_NOT_OWNER');
  });

  it('listing without bundleFileId gives owner 404 BUNDLE_NOT_AVAILABLE', async () => {
    await prisma.agents_purchase.create({
      data: {
        userId: buyerUserId,
        listingId: listingNoBundleId,
        pricingTypeAtSale: AgentsPricingType.FREE,
        amountToman: 0n,
        commissionToman: 0n,
        makerEarnedToman: 0n,
        status: AgentsPurchaseStatus.COMPLETED,
      },
    });

    const token = await signAccessToken(buyerUserId);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agents/me/library/${listingNoBundleId.toString()}/download`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BUNDLE_NOT_AVAILABLE');
  });

  it('refunded purchase no longer grants download access', async () => {
    await prisma.agents_purchase.create({
      data: {
        userId: buyerUserId,
        listingId: listingWithBundleId,
        pricingTypeAtSale: AgentsPricingType.ONE_TIME,
        amountToman: 50_000n,
        commissionToman: 10_000n,
        makerEarnedToman: 40_000n,
        status: AgentsPurchaseStatus.REFUNDED,
        refundedAt: new Date(),
        refundReason: 'test refund',
      },
    });

    const token = await signAccessToken(buyerUserId);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agents/me/library/${listingWithBundleId.toString()}/download`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCESS_DENIED_NOT_OWNER');
  });

  it('audit row written for a successful download', async () => {
    await prisma.agents_purchase.create({
      data: {
        userId: buyerUserId,
        listingId: listingWithBundleId,
        pricingTypeAtSale: AgentsPricingType.ONE_TIME,
        amountToman: 50_000n,
        commissionToman: 10_000n,
        makerEarnedToman: 40_000n,
        status: AgentsPurchaseStatus.COMPLETED,
      },
    });

    const before = new Date();
    const token = await signAccessToken(buyerUserId);
    const res = await request(app.getHttpServer())
      .get(`/api/v1/agents/me/library/${listingWithBundleId.toString()}/download`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((response, cb) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);

    // The audit interceptor fires the row write fire-and-forget after
    // the response stream finishes; poll briefly so the assertion is
    // not racing the microtask that performs the insert.
    let audit: Awaited<ReturnType<typeof prisma.auditLog.findFirst>> = null;
    for (let i = 0; i < 20 && audit === null; i++) {
      audit = await prisma.auditLog.findFirst({
        where: {
          action: 'AGENTS_BUNDLE_DOWNLOADED',
          actorUserId: buyerUserId,
          resourceId: listingWithBundleId.toString(),
          createdAt: { gte: before },
        },
      });
      if (audit === null) await new Promise((r) => setTimeout(r, 50));
    }
    expect(audit).not.toBeNull();
    expect(audit?.resource).toBe('agent_listing');
  });
});
