import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';

import { ModuleRegistryService } from './module-registry.service';
import type {
  AdminPageDefinition,
  NotificationTypeDefinition,
  PermissionDefinition,
  PlatformModule,
} from './types';

interface MockPrisma {
  permission: { upsert: jest.Mock };
  role: { findMany: jest.Mock };
  rolePermission: { createMany: jest.Mock };
}

function buildPrisma(overrides: Partial<MockPrisma> = {}): {
  prisma: PrismaService;
  mock: MockPrisma;
} {
  const mock: MockPrisma = {
    permission: {
      upsert: overrides.permission?.upsert ?? jest.fn().mockResolvedValue({ id: 100n }),
    },
    role: {
      findMany: overrides.role?.findMany ?? jest.fn().mockResolvedValue([]),
    },
    rolePermission: {
      createMany: overrides.rolePermission?.createMany ?? jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  return { prisma: mock as unknown as PrismaService, mock };
}

function buildNotifications(): { service: NotificationsService; registerType: jest.Mock } {
  const registerType = jest.fn();
  return {
    service: { registerType } as unknown as NotificationsService,
    registerType,
  };
}

function buildPayments(): { service: PaymentsService; registerAllowedPurposes: jest.Mock } {
  const registerAllowedPurposes = jest.fn();
  return {
    service: { registerAllowedPurposes } as unknown as PaymentsService,
    registerAllowedPurposes,
  };
}

function buildModule(overrides: Partial<PlatformModule> = {}): PlatformModule {
  const base: PlatformModule = {
    name: 'sample',
    persianName: 'نمونه',
    version: '0.1.0',
    enabled: true,
    registerNestModule: () => class {},
    registerPermissions: () => [],
    registerAuditActions: () => ({}),
  };
  return { ...base, ...overrides } as PlatformModule;
}

describe('ModuleRegistryService', () => {
  describe('register / get', () => {
    it('stores and retrieves modules', () => {
      const { prisma } = buildPrisma();
      const { service: notif } = buildNotifications();
      const { service: pay } = buildPayments();
      const registry = new ModuleRegistryService(prisma, notif, pay);

      const mod = buildModule({ name: 'agents' });
      registry.register(mod);

      expect(registry.getRegistered()).toEqual([mod]);
      expect(registry.getByName('agents')).toBe(mod);
      expect(registry.getByName('missing')).toBeUndefined();
    });

    it('throws on duplicate registration', () => {
      const { prisma } = buildPrisma();
      const { service: notif } = buildNotifications();
      const { service: pay } = buildPayments();
      const registry = new ModuleRegistryService(prisma, notif, pay);

      registry.register(buildModule({ name: 'dup' }));
      expect(() => registry.register(buildModule({ name: 'dup' }))).toThrow(/already registered/);
    });

    it('filters disabled modules from getEnabledModules', () => {
      const { prisma } = buildPrisma();
      const { service: notif } = buildNotifications();
      const { service: pay } = buildPayments();
      const registry = new ModuleRegistryService(prisma, notif, pay);

      const on = buildModule({ name: 'on', enabled: true });
      const off = buildModule({ name: 'off', enabled: false });
      registry.register(on);
      registry.register(off);

      expect(registry.getEnabledModules()).toEqual([on]);
    });
  });

  describe('mergePermissions', () => {
    it('upserts every permission and links default roles that exist', async () => {
      const { prisma, mock } = buildPrisma({
        permission: { upsert: jest.fn().mockResolvedValue({ id: 500n }) },
        role: {
          findMany: jest.fn().mockResolvedValue([{ id: 1n, name: 'admin' }]),
        },
        rolePermission: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      });
      const { service: notif } = buildNotifications();
      const { service: pay } = buildPayments();
      const registry = new ModuleRegistryService(prisma, notif, pay);

      const perms: PermissionDefinition[] = [
        {
          code: 'agents:moderate:listing',
          description: 'Moderate listings',
          persianDescription: 'مدیریت آگهی‌ها',
          defaultRoles: ['admin', 'ghost_role'],
        },
      ];
      registry.register(buildModule({ name: 'agents', registerPermissions: () => perms }));

      const warnSpy = jest
        .spyOn((registry as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
        .mockImplementation(() => undefined);

      await registry.mergePermissions();

      expect(mock.permission.upsert).toHaveBeenCalledWith({
        where: { code: 'agents:moderate:listing' },
        create: { code: 'agents:moderate:listing', description: 'Moderate listings' },
        update: { description: 'Moderate listings' },
      });
      expect(mock.rolePermission.createMany).toHaveBeenCalledWith({
        data: [{ roleId: 1n, permissionId: 500n }],
        skipDuplicates: true,
      });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ghost_role'));
    });

    it('skips disabled modules', async () => {
      const { prisma, mock } = buildPrisma();
      const { service: notif } = buildNotifications();
      const { service: pay } = buildPayments();
      const registry = new ModuleRegistryService(prisma, notif, pay);

      registry.register(
        buildModule({
          enabled: false,
          registerPermissions: () => [
            {
              code: 'x:y:z',
              description: 'd',
              persianDescription: 'd',
            },
          ],
        }),
      );

      await registry.mergePermissions();
      expect(mock.permission.upsert).not.toHaveBeenCalled();
    });
  });

  describe('mergeNotificationTypes', () => {
    it('forwards each enabled module type to NotificationsService.registerType', () => {
      const { prisma } = buildPrisma();
      const { service: notif, registerType } = buildNotifications();
      const { service: pay } = buildPayments();
      const registry = new ModuleRegistryService(prisma, notif, pay);

      const types: NotificationTypeDefinition[] = [
        { type: 'AGENTS_LISTING_APPROVED', inApp: { titleFa: 't', bodyFa: () => 'b' } },
      ];
      registry.register(buildModule({ registerNotificationTypes: () => types }));

      registry.mergeNotificationTypes();
      expect(registerType).toHaveBeenCalledWith(types[0]);
    });
  });

  describe('mergeAdminPages', () => {
    it('returns sorted pages by order then titleFa', () => {
      const { prisma } = buildPrisma();
      const { service: notif } = buildNotifications();
      const { service: pay } = buildPayments();
      const registry = new ModuleRegistryService(prisma, notif, pay);

      const pagesA: AdminPageDefinition[] = [
        { path: '/admin/a/1', titleFa: 'ب', permission: 'a:r' },
        { path: '/admin/a/2', titleFa: 'الف', permission: 'a:r', order: 1 },
      ];
      const pagesB: AdminPageDefinition[] = [
        { path: '/admin/b/1', titleFa: 'ج', permission: 'b:r', order: 5 },
      ];
      registry.register(buildModule({ name: 'a', registerAdminPages: () => pagesA }));
      registry.register(buildModule({ name: 'b', registerAdminPages: () => pagesB }));

      const merged = registry.mergeAdminPages();
      expect(merged.map((p) => p.path)).toEqual(['/admin/a/2', '/admin/b/1', '/admin/a/1']);
    });
  });

  describe('mergePaymentPurposes', () => {
    it('returns deduped flat list and registers it on PaymentsService', () => {
      const { prisma } = buildPrisma();
      const { service: notif } = buildNotifications();
      const { service: pay, registerAllowedPurposes } = buildPayments();
      const registry = new ModuleRegistryService(prisma, notif, pay);

      registry.register(
        buildModule({
          name: 'a',
          registerPaymentPurposes: () => ['agents_listing_fee', 'shared'],
        }),
      );
      registry.register(
        buildModule({
          name: 'b',
          registerPaymentPurposes: () => ['shared', 'builders_bid_deposit'],
        }),
      );

      const merged = registry.mergePaymentPurposes();
      expect(merged.sort()).toEqual(
        ['agents_listing_fee', 'builders_bid_deposit', 'shared'].sort(),
      );
      expect(registerAllowedPurposes).toHaveBeenCalledWith(merged);
    });

    it('returns empty list when no module exposes purposes', () => {
      const { prisma } = buildPrisma();
      const { service: notif } = buildNotifications();
      const { service: pay, registerAllowedPurposes } = buildPayments();
      const registry = new ModuleRegistryService(prisma, notif, pay);

      registry.register(buildModule({ name: 'noop' }));
      const merged = registry.mergePaymentPurposes();
      expect(merged).toEqual([]);
      expect(registerAllowedPurposes).toHaveBeenCalledWith([]);
    });
  });
});
