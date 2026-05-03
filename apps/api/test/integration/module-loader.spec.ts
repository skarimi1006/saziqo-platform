import 'reflect-metadata';
import '../../src/common/bigint-serialization';

import { Logger } from '@nestjs/common';

import { ErrorCode } from '../../src/common/types/response.types';
import { ConfigService } from '../../src/config/config.service';
import { AuditService } from '../../src/core/audit/audit.service';
import { type FileStore } from '../../src/core/files/file-store.interface';
import { LedgerService } from '../../src/core/ledger/ledger.service';
import { ModuleLoaderService } from '../../src/core/module-registry/module-loader.service';
import { ModuleRegistryService } from '../../src/core/module-registry/module-registry.service';
import type { ModuleDeps, PlatformModule } from '../../src/core/module-registry/types';
import { NotificationsService } from '../../src/core/notifications/notifications.service';
import { PaymentsService } from '../../src/core/payments/payments.service';
import { PrismaService } from '../../src/core/prisma/prisma.service';
import { RedisService } from '../../src/core/redis/redis.service';

// SECURITY: This is a smoke test for the boot sequence. It does NOT exercise
// a real Postgres — the loader's DB calls are mocked via PrismaService.
// The append-only audit-log spec covers the real-DB path; this spec covers
// the orchestration logic (registration, merges, lifecycle hooks, fail-loud
// behavior on hook failure).

interface PrismaMock {
  moduleInstall: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  permission: { upsert: jest.Mock };
  role: { findMany: jest.Mock };
  rolePermission: { createMany: jest.Mock };
}

function buildPrisma(installed: Set<string> = new Set()): {
  prisma: PrismaService;
  mock: PrismaMock;
} {
  const mock: PrismaMock = {
    moduleInstall: {
      findUnique: jest.fn(({ where }: { where: { name: string } }) =>
        installed.has(where.name)
          ? Promise.resolve({ id: 1n, name: where.name, version: '0.0.0', installedAt: new Date() })
          : Promise.resolve(null),
      ),
      create: jest.fn(({ data }: { data: { name: string; version: string } }) => {
        installed.add(data.name);
        return Promise.resolve({ id: 1n, ...data, installedAt: new Date() });
      }),
    },
    permission: { upsert: jest.fn().mockResolvedValue({ id: 100n }) },
    role: { findMany: jest.fn().mockResolvedValue([]) },
    rolePermission: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  return { prisma: mock as unknown as PrismaService, mock };
}

function buildRegistry(prisma: PrismaService): {
  registry: ModuleRegistryService;
  notifications: NotificationsService;
  payments: PaymentsService;
} {
  const notifications = {
    registerType: jest.fn(),
  } as unknown as NotificationsService;
  const payments = {
    registerAllowedPurposes: jest.fn(),
  } as unknown as PaymentsService;
  const registry = new ModuleRegistryService(prisma, notifications, payments);
  return { registry, notifications, payments };
}

function buildLoader(
  modules: PlatformModule[],
  prisma: PrismaService,
  registry: ModuleRegistryService,
): ModuleLoaderService {
  const redis = {} as RedisService;
  const fileStore = { name: 'mock' } as FileStore;
  const ledger = {} as LedgerService;
  const payments = { registerAllowedPurposes: jest.fn() } as unknown as PaymentsService;
  const notifications = { registerType: jest.fn() } as unknown as NotificationsService;
  const audit = {} as AuditService;
  const config = {} as ConfigService;
  return new ModuleLoaderService(
    registry,
    prisma,
    redis,
    fileStore,
    ledger,
    payments,
    notifications,
    audit,
    config,
    modules,
  );
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

describe('ModuleLoaderService', () => {
  describe('empty MODULES array', () => {
    it('boots successfully and logs no-modules-registered', async () => {
      const { prisma } = buildPrisma();
      const { registry } = buildRegistry(prisma);
      const loader = buildLoader([], prisma, registry);

      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

      await expect(loader.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith('[module-loader] no modules registered');
      expect(registry.getRegistered()).toEqual([]);

      logSpy.mockRestore();
    });
  });

  describe('mock module registration', () => {
    it('registers, runs merges, and invokes onInstall + onBoot on first boot', async () => {
      const { prisma, mock } = buildPrisma();
      const { registry, notifications, payments } = buildRegistry(prisma);

      const onInstall = jest.fn().mockResolvedValue(undefined);
      const onBoot = jest.fn().mockResolvedValue(undefined);
      const mod = buildModule({
        name: 'agents',
        registerPermissions: () => [
          {
            code: 'agents:read:listing',
            description: 'Read listings',
            persianDescription: 'خواندن آگهی‌ها',
          },
        ],
        registerNotificationTypes: () => [
          { type: 'AGENTS_LISTING_APPROVED', inApp: { titleFa: 't', bodyFa: () => 'b' } },
        ],
        registerPaymentPurposes: () => ['agents_listing_fee'],
        onInstall,
        onBoot,
      });

      const loader = buildLoader([mod], prisma, registry);
      await loader.onApplicationBootstrap();

      // Registry now knows about the module.
      expect(registry.getByName('agents')).toBe(mod);

      // Merges fired.
      expect(mock.permission.upsert).toHaveBeenCalledWith({
        where: { code: 'agents:read:listing' },
        create: { code: 'agents:read:listing', description: 'Read listings' },
        update: { description: 'Read listings' },
      });
      expect(
        (notifications as unknown as { registerType: jest.Mock }).registerType,
      ).toHaveBeenCalled();
      expect(
        (payments as unknown as { registerAllowedPurposes: jest.Mock }).registerAllowedPurposes,
      ).toHaveBeenCalledWith(['agents_listing_fee']);

      // First-install path: onInstall ran, install row stamped, onBoot ran.
      expect(onInstall).toHaveBeenCalledTimes(1);
      expect(mock.moduleInstall.create).toHaveBeenCalledWith({
        data: { name: 'agents', version: '0.1.0' },
      });
      expect(onBoot).toHaveBeenCalledTimes(1);
    });

    it('skips onInstall on subsequent boots and only invokes onBoot', async () => {
      const installed = new Set<string>(['agents']);
      const { prisma, mock } = buildPrisma(installed);
      const { registry } = buildRegistry(prisma);

      const onInstall = jest.fn().mockResolvedValue(undefined);
      const onBoot = jest.fn().mockResolvedValue(undefined);
      const mod = buildModule({ name: 'agents', onInstall, onBoot });

      const loader = buildLoader([mod], prisma, registry);
      await loader.onApplicationBootstrap();

      expect(onInstall).not.toHaveBeenCalled();
      expect(mock.moduleInstall.create).not.toHaveBeenCalled();
      expect(onBoot).toHaveBeenCalledTimes(1);
    });

    it('skips disabled modules from lifecycle hooks but still registers them', async () => {
      const { prisma, mock } = buildPrisma();
      const { registry } = buildRegistry(prisma);

      const onBoot = jest.fn().mockResolvedValue(undefined);
      const mod = buildModule({ name: 'agents', enabled: false, onBoot });

      const loader = buildLoader([mod], prisma, registry);
      await loader.onApplicationBootstrap();

      expect(registry.getByName('agents')).toBe(mod);
      expect(onBoot).not.toHaveBeenCalled();
      expect(mock.moduleInstall.create).not.toHaveBeenCalled();
    });

    it('rethrows and logs MODULE_BOOT_FAILED when onBoot throws', async () => {
      const { prisma } = buildPrisma();
      const { registry } = buildRegistry(prisma);

      const boom = new Error('database unreachable');
      const mod = buildModule({
        name: 'agents',
        onBoot: jest.fn().mockRejectedValue(boom),
      });

      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const loader = buildLoader([mod], prisma, registry);
      await expect(loader.onApplicationBootstrap()).rejects.toBe(boom);

      const message = errorSpy.mock.calls[0]?.[0];
      expect(typeof message).toBe('string');
      expect(message as string).toContain(ErrorCode.MODULE_BOOT_FAILED);
      expect(message as string).toContain('agents');
      expect(message as string).toContain('onBoot');

      errorSpy.mockRestore();
    });
  });

  describe('ModuleDeps hand-off', () => {
    it('passes a populated ModuleDeps to onBoot', async () => {
      const { prisma } = buildPrisma();
      const { registry } = buildRegistry(prisma);

      let received: ModuleDeps | undefined;
      const mod = buildModule({
        name: 'agents',
        onBoot: async (deps) => {
          received = deps;
        },
      });

      const loader = buildLoader([mod], prisma, registry);
      await loader.onApplicationBootstrap();

      expect(received).toBeDefined();
      expect(received?.prisma).toBeDefined();
      expect(received?.redis).toBeDefined();
      expect(received?.fileStore).toBeDefined();
      expect(received?.ledger).toBeDefined();
      expect(received?.payments).toBeDefined();
      expect(received?.notifications).toBeDefined();
      expect(received?.audit).toBeDefined();
      expect(received?.config).toBeDefined();
      expect(received?.logger).toBeDefined();
    });
  });
});
