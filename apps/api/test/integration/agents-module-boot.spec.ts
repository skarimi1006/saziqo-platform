import 'reflect-metadata';
import '../../src/common/bigint-serialization';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { NotificationChannel } from '@prisma/client';

import { AppModule } from '../../src/app.module';
import { ErrorCode } from '../../src/common/types/response.types';
import { CartAggregatorService } from '../../src/core/cart/cart-aggregator.service';
import { ModuleRegistryService } from '../../src/core/module-registry/module-registry.service';
import {
  type NotificationRow,
  NotificationsService,
} from '../../src/core/notifications/notifications.service';
import { PaymentsService } from '../../src/core/payments/payments.service';
import { PrismaService } from '../../src/core/prisma/prisma.service';

// Phase 1D smoke test — real Postgres required. Verifies that the agents
// module registers correctly at boot: permissions are seeded, the settings
// singleton and default categories exist, the notification template renders,
// the payment purpose is accepted, and the admin-pages registry includes
// the agents listing page.
describe('agents module boot — smoke test (Phase 1D)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let notifications: NotificationsService;
  let payments: PaymentsService;
  let registry: ModuleRegistryService;
  let cartAggregator: CartAggregatorService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bufferLogs: false });
    await app.init();

    prisma = app.get(PrismaService);
    notifications = app.get(NotificationsService);
    payments = app.get(PaymentsService);
    registry = app.get(ModuleRegistryService);
    cartAggregator = app.get(CartAggregatorService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('seeds 14 agents:* permissions into the database', async () => {
    const count = await prisma.permission.count({
      where: { code: { startsWith: 'agents:' } },
    });
    expect(count).toBe(14);
  });

  it('seeds the agents_settings singleton row (id=1) with default values', async () => {
    const settings = await prisma.agents_settings.findUnique({ where: { id: BigInt(1) } });
    expect(settings).not.toBeNull();
    expect(settings?.commissionPercent).toBe(20);
    expect(settings?.showFeaturedSection).toBe(true);
    expect(settings?.featuredItemCount).toBe(6);
  });

  it('seeds exactly 7 default categories', async () => {
    const count = await prisma.agents_category.count();
    expect(count).toBe(7);
  });

  it('renders the AGENTS_PURCHASE_RECEIPT notification template', () => {
    const fakeRow: NotificationRow = {
      id: BigInt(1),
      userId: BigInt(1),
      channel: NotificationChannel.IN_APP,
      type: 'AGENTS_PURCHASE_RECEIPT',
      payload: { listingTitle: 'ایجنت تستی', runs: 5 },
      readAt: null,
      createdAt: new Date(),
    };

    const view = notifications.renderForUser(fakeRow);
    expect(view.renderedTitle).toBe('خرید شما ثبت شد');
    expect(view.renderedBody).toContain('ایجنت تستی');
    expect(view.renderedBody).toContain('5 اجرا فعال شد');
  });

  it("accepts purpose 'agents_purchase' without throwing an invalid-purpose error", async () => {
    // A non-existent userId triggers NOT_FOUND — the purpose validation fires
    // first, so NOT_FOUND here proves the purpose was accepted. A
    // VALIDATION_ERROR would mean the purpose was rejected.
    await expect(
      payments.initiate({
        userId: BigInt(Number.MAX_SAFE_INTEGER),
        amount: BigInt(1000),
        purpose: 'agents_purchase',
        description: 'smoke test',
      }),
    ).rejects.toMatchObject({ response: { code: ErrorCode.NOT_FOUND } });
  });

  it('includes /admin/agents/listings in the merged admin pages registry', () => {
    const pages = registry.mergeAdminPages();
    const paths = pages.map((p) => p.path);
    expect(paths).toContain('/admin/agents/listings');
  });

  // Test Gate 1 — full-coverage assertions

  it('registers the agents PlatformModule with the registry', () => {
    const mod = registry.getByName('agents');
    expect(mod).toBeDefined();
    expect(mod?.version).toBe('0.1.0');
    expect(mod?.enabled).toBe(true);
  });

  it('registers all 9 agents notification templates', () => {
    const expected = [
      'AGENTS_LISTING_APPROVED',
      'AGENTS_LISTING_REJECTED',
      'AGENTS_LISTING_SUSPENDED',
      'AGENTS_PURCHASE_RECEIPT',
      'AGENTS_NEW_SALE',
      'AGENTS_RUNS_LOW',
      'AGENTS_RUNS_DEPLETED',
      'AGENTS_REVIEW_POSTED',
      'AGENTS_NEW_LISTING_PENDING',
    ];
    for (const type of expected) {
      expect(registry.getNotificationTypeOwner(type)).toBe('agents');
    }
  });

  it('merges both agents payment purposes into the registry', () => {
    const purposes = registry.mergePaymentPurposes();
    expect(purposes).toEqual(expect.arrayContaining(['agents_purchase', 'agents_run_pack']));
  });

  it('exposes all 5 agents admin pages via the registry', () => {
    const pages = registry.mergeAdminPages();
    const agentsPaths = pages.map((p) => p.path).filter((p) => p.startsWith('/admin/agents/'));
    expect(agentsPaths).toEqual(
      expect.arrayContaining([
        '/admin/agents/listings',
        '/admin/agents/categories',
        '/admin/agents/featured',
        '/admin/agents/sales',
        '/admin/agents/settings',
      ]),
    );
    expect(agentsPaths).toHaveLength(5);
  });

  it('registers the agents cart adapter with the cart aggregator on boot', () => {
    expect(cartAggregator.getRegisteredModuleSources()).toContain('agents');
  });
});
