import 'reflect-metadata';
import '../../src/common/bigint-serialization';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AgentsListingStatus, AgentsPricingType } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/core/prisma/prisma.service';

// Phase 2F integration test — real Postgres required (FTS + trigram).
// Seeds a small fixture of PUBLISHED listings with distinct titleFa /
// shortDescFa / longDescFaMd content so we can assert FTS hits, ILIKE
// fallback hits, and combined-filter behaviour without flakiness.
describe('GET /api/v1/agents/search (Phase 2F)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let makerUserId: bigint;
  let categoryAId: bigint;
  let categoryBId: bigint;

  const TEST_PHONE = '+989000099501';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bufferLogs: false });
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = app.get(PrismaService);

    const maker = await prisma.user.upsert({
      where: { phone: TEST_PHONE },
      create: { phone: TEST_PHONE, status: 'ACTIVE', firstName: 'تست', lastName: 'سرچ' },
      update: {},
    });
    makerUserId = maker.id;

    await prisma.agents_listing.deleteMany({ where: { makerUserId } });

    const cats = await prisma.agents_category.findMany({
      orderBy: { order: 'asc' },
      take: 2,
    });
    categoryAId = cats[0]!.id;
    categoryBId = cats[1]!.id;

    // Fixture rows — chosen so that:
    //   "فارسی" hits row#1 (in titleFa) and row#2 (in shortDescFa) via FTS;
    //   "ایجنت" appears in many rows;
    //   "زبانشناس" matches via ILIKE only — it appears as a substring inside
    //     a single multi-word longDesc but the FTS lexeme split is different
    //     enough that a sparse 1-result FTS hit still triggers fallback.
    const fixtures: Array<{
      slug: string;
      titleFa: string;
      shortDescFa: string;
      longDescFaMd: string;
      categoryId: bigint;
      pricingType: AgentsPricingType;
      totalUsers: bigint;
    }> = [
      {
        slug: 'persian-copywriter-search',
        titleFa: 'کپی‌رایتر فارسی حرفه‌ای',
        shortDescFa: 'تولید محتوای تبلیغاتی',
        longDescFaMd: 'این ایجنت برای نگارش متون تبلیغاتی فارسی طراحی شده.',
        categoryId: categoryAId,
        pricingType: AgentsPricingType.FREE,
        totalUsers: 50n,
      },
      {
        slug: 'translation-helper',
        titleFa: 'دستیار ترجمه',
        shortDescFa: 'ترجمه فارسی به انگلیسی',
        longDescFaMd: 'یک ایجنت ترجمه دو زبانه.',
        categoryId: categoryAId,
        pricingType: AgentsPricingType.ONE_TIME,
        totalUsers: 30n,
      },
      {
        slug: 'code-reviewer-fa',
        titleFa: 'بازبین کد',
        shortDescFa: 'تحلیل کد به زبان فارسی',
        longDescFaMd: 'ابزاری برای بازبینی کد.',
        categoryId: categoryBId,
        pricingType: AgentsPricingType.FREE,
        totalUsers: 100n,
      },
      {
        slug: 'devops-helper',
        titleFa: 'دستیار دواپس',
        shortDescFa: 'استقرار و مدیریت سرویس‌ها',
        longDescFaMd: 'بدون ارتباط با کلیدواژه تست — این برای انحراف داده‌ای است.',
        categoryId: categoryBId,
        pricingType: AgentsPricingType.PER_RUN,
        totalUsers: 10n,
      },
      {
        slug: 'persian-data-extractor',
        titleFa: 'استخراج‌کننده داده',
        shortDescFa: 'تجزیه فایل‌های فارسی',
        longDescFaMd: 'ایجنت زبانشناس برای پردازش متون فارسی.',
        categoryId: categoryBId,
        pricingType: AgentsPricingType.FREE,
        totalUsers: 5n,
      },
    ];

    for (const f of fixtures) {
      await prisma.agents_listing.create({
        data: {
          slug: `${f.slug}-${Date.now()}`,
          titleFa: f.titleFa,
          shortDescFa: f.shortDescFa,
          longDescFaMd: f.longDescFaMd,
          categoryId: f.categoryId,
          makerUserId,
          pricingType: f.pricingType,
          oneTimePriceToman: f.pricingType === AgentsPricingType.ONE_TIME ? 50000n : null,
          status: AgentsListingStatus.PUBLISHED,
          publishedAt: new Date(),
          totalUsers: f.totalUsers,
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

  // ─── Validation ──────────────────────────────────────────────────────

  it('returns 400 VALIDATION_ERROR when q is missing', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/agents/search');
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when q is empty string', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/agents/search?q=');
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when q is shorter than 2 chars', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/agents/search?q=a');
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
  });

  // ─── FTS path ────────────────────────────────────────────────────────

  it('Persian query "فارسی" matches listings via FTS', async () => {
    const res = await request(app.getHttpServer()).get(
      `/api/v1/agents/search?q=${encodeURIComponent('فارسی')}`,
    );
    expect(res.status).toBe(200);
    const titles = (res.body.data as Array<{ titleFa: string; slug: string }>).map(
      (d) => d.titleFa,
    );
    expect(titles).toContain('کپی‌رایتر فارسی حرفه‌ای');
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('returns ListingCardDto shape', async () => {
    const res = await request(app.getHttpServer()).get(
      `/api/v1/agents/search?q=${encodeURIComponent('ایجنت')}&limit=1`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toMatchObject({
      id: expect.any(String),
      slug: expect.any(String),
      titleFa: expect.any(String),
      shortDescFa: expect.any(String),
      categoryId: expect.any(String),
      categoryNameFa: expect.any(String),
      pricingType: expect.any(String),
    });
    expect(res.body.meta).toMatchObject({
      nextCursor: expect.anything(),
      hasMore: expect.any(Boolean),
    });
  });

  // ─── Combined filters ────────────────────────────────────────────────

  it('combined filter (q + categoryId) restricts results', async () => {
    const res = await request(app.getHttpServer()).get(
      `/api/v1/agents/search?q=${encodeURIComponent('فارسی')}&categoryId=${categoryAId.toString()}`,
    );
    expect(res.status).toBe(200);
    for (const item of res.body.data as Array<{ categoryId: string }>) {
      expect(item.categoryId).toBe(categoryAId.toString());
    }
  });

  it('combined filter (q + freeOnly=true) restricts to FREE pricing', async () => {
    const res = await request(app.getHttpServer()).get(
      `/api/v1/agents/search?q=${encodeURIComponent('فارسی')}&freeOnly=true`,
    );
    expect(res.status).toBe(200);
    for (const item of res.body.data as Array<{ pricingType: string }>) {
      expect(item.pricingType).toBe('FREE');
    }
  });

  // ─── ILIKE fallback ──────────────────────────────────────────────────

  it('ILIKE fallback returns slug-substring matches when FTS misses', async () => {
    // 'reviewer-fa' is a slug-only substring; FTS on 'simple' lexemes
    // splits the slug differently, so this query exercises the trigram
    // fallback even when FTS yields zero or low hits.
    const res = await request(app.getHttpServer()).get('/api/v1/agents/search?q=reviewer-fa');
    expect(res.status).toBe(200);
    const slugs = (res.body.data as Array<{ slug: string }>).map((d) => d.slug);
    expect(slugs.some((s) => s.includes('code-reviewer-fa'))).toBe(true);
  });
});
