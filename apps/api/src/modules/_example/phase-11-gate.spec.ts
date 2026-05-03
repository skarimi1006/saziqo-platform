// Test Gate 11 — verifies Phase Group 11's acceptance criteria. Items 1, 2,
// 8, and 9 are already covered elsewhere and are cross-referenced inline.
// Items 3, 4, 5, 6, 7 are verified here using the real _example module
// against the real registry + a real ModuleLoaderService with mocked Prisma
// (so the full boot orchestration runs without needing a Postgres instance).
//
// Cross-references:
//   - Item 1 (`MODULES` compiles)        → `pnpm typecheck` passes; this file
//                                            statically imports MODULES, so a
//                                            failing import would block compile.
//   - Item 2 (empty MODULES boots clean)  → test/integration/module-loader.spec.ts
//                                            "boots successfully and logs
//                                            no-modules-registered".
//   - Item 8 (onInstall once / onBoot every) → module-loader.spec.ts
//                                            "skips onInstall on subsequent
//                                            boots and only invokes onBoot".
//   - Item 9 (boot failure halts loudly)   → module-loader.spec.ts
//                                            "rethrows and logs
//                                            MODULE_BOOT_FAILED when onBoot
//                                            throws".

import 'reflect-metadata';

import { HttpException, Logger } from '@nestjs/common';

import { ErrorCode } from '../../common/types/response.types';
import { ConfigService } from '../../config/config.service';
import { AuditService } from '../../core/audit/audit.service';
import { type FileStore } from '../../core/files/file-store.interface';
import { LedgerService } from '../../core/ledger/ledger.service';
import { ModuleLoaderService } from '../../core/module-registry/module-loader.service';
import { ModuleRegistryService } from '../../core/module-registry/module-registry.service';
import { NotificationsService } from '../../core/notifications/notifications.service';
import { PaymentsService } from '../../core/payments/payments.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { MODULES } from '../../modules.config';

import exampleModule from './index';

interface PrismaMock {
  moduleInstall: { findUnique: jest.Mock; create: jest.Mock };
  permission: { upsert: jest.Mock };
  role: { findMany: jest.Mock };
  rolePermission: { createMany: jest.Mock };
}

function buildPrisma(): { prisma: PrismaService; mock: PrismaMock } {
  const mock: PrismaMock = {
    moduleInstall: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 1n }),
    },
    permission: {
      upsert: jest.fn(({ where }: { where: { code: string } }) =>
        Promise.resolve({ id: BigInt(where.code.length), code: where.code }),
      ),
    },
    role: {
      findMany: jest.fn(({ where }: { where: { name: { in: string[] } } }) =>
        Promise.resolve(where.name.in.map((name, i) => ({ id: BigInt(i + 1), name }))),
      ),
    },
    rolePermission: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  return { prisma: mock as unknown as PrismaService, mock };
}

describe('Phase 11 Test Gate — module registry verification', () => {
  // Item 3: loader logs registration when _example is loaded.
  // Item 4: both _example permissions get upserted into Permission table.
  // Item 5: _example admin page appears in mergeAdminPages output.
  // Item 6: _example_topup is accepted by the payment-purpose allow-list.
  // (Run as one boot pass so we exercise the same code path as production.)
  describe('full registration pass against the real _example module', () => {
    let logSpy: jest.SpyInstance;
    let registry: ModuleRegistryService;
    let mock: PrismaMock;
    let payments: PaymentsService;
    let registeredPurposes: string[] = [];

    beforeAll(async () => {
      logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

      const built = buildPrisma();
      mock = built.mock;

      const notifications = {
        registerType: jest.fn(),
      } as unknown as NotificationsService;

      payments = {
        registerAllowedPurposes: jest.fn((purposes: readonly string[]) => {
          registeredPurposes = [...purposes];
        }),
      } as unknown as PaymentsService;

      registry = new ModuleRegistryService(built.prisma, notifications, payments);

      const loader = new ModuleLoaderService(
        registry,
        built.prisma,
        {} as RedisService,
        { name: 'mock' } as FileStore,
        {} as LedgerService,
        payments,
        notifications,
        {} as AuditService,
        {} as ConfigService,
        [exampleModule],
      );

      await loader.onApplicationBootstrap();
    });

    afterAll(() => {
      logSpy.mockRestore();
    });

    it('Item 3 — loader logs `[module-loader] registered _example v0.1.0 (enabled=true)`', () => {
      expect(logSpy).toHaveBeenCalledWith(
        '[module-loader] registered _example v0.1.0 (enabled=true)',
      );
    });

    it('Item 3 — example module logs onInstall and onBoot on first boot', () => {
      expect(logSpy).toHaveBeenCalledWith('[_example] first install');
      expect(logSpy).toHaveBeenCalledWith('[_example] booted');
    });

    it('Item 4 — both _example permission codes are upserted', () => {
      const upsertedCodes = mock.permission.upsert.mock.calls.map(
        (c) => (c[0] as { where: { code: string } }).where.code,
      );
      expect(upsertedCodes).toEqual(
        expect.arrayContaining(['_example:read:ping', '_example:moderate']),
      );
    });

    it('Item 4 — _example:read:ping is upserted with the documented description', () => {
      expect(mock.permission.upsert).toHaveBeenCalledWith({
        where: { code: '_example:read:ping' },
        create: { code: '_example:read:ping', description: 'Read example ping' },
        update: { description: 'Read example ping' },
      });
    });

    it('Item 5 — _example admin page appears in mergeAdminPages output', () => {
      const pages = registry.mergeAdminPages();
      const examplePage = pages.find((p) => p.path === '/admin/_example');
      expect(examplePage).toBeDefined();
      expect(examplePage?.titleFa).toBe('مثال (توسعه)');
      expect(examplePage?.permission).toBe('_example:moderate');
    });

    it('Item 6 — _example_topup is registered in the payment-purpose allow-list', () => {
      expect(registeredPurposes).toContain('_example_topup');
      expect(payments.registerAllowedPurposes).toHaveBeenCalledWith(
        expect.arrayContaining(['_example_topup']),
      );
    });
  });

  // Item 6 (extended): the purpose the registry merged is actually accepted by
  // PaymentsService.validatePurpose. We construct a real PaymentsService with
  // null collaborators and exercise the private validatePurpose() through
  // initiate() — using a non-existent userId so initiate throws NOT_FOUND
  // *after* validation rather than VALIDATION_ERROR (which is what we'd see
  // if the purpose were rejected).
  describe('Item 6 — PaymentsService accepts _example_topup post-merge', () => {
    it('initiate({ purpose: "_example_topup" }) passes purpose validation', async () => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(null) },
        payment: { create: jest.fn(), update: jest.fn() },
      } as unknown as PrismaService;

      const provider = { name: 'mock-provider' } as { name: string };

      const service = new PaymentsService(
        prisma,
        { get: () => '3001' } as unknown as ConfigService,
        { dispatch: jest.fn() } as unknown as NotificationsService,
        {} as never,
        {} as never,
        {} as LedgerService,
        provider as never,
      );

      // Simulate the registry handing the merged purposes to the service.
      service.registerAllowedPurposes(['_example_topup']);

      // initiate() resolves user first; for a missing user it throws
      // NOT_FOUND. If validatePurpose rejected '_example_topup' it would
      // throw VALIDATION_ERROR before the user lookup.
      await expect(
        service.initiate({
          userId: 999_999n,
          amount: 1000n,
          purpose: '_example_topup',
          description: 'gate-test',
        }),
      ).rejects.toMatchObject({
        getResponse: expect.any(Function),
      });

      // Pull the actual error code to confirm we got past purpose validation.
      try {
        await service.initiate({
          userId: 999_999n,
          amount: 1000n,
          purpose: '_example_topup',
          description: 'gate-test',
        });
      } catch (err) {
        const code = (err as HttpException).getResponse() as { code: string };
        expect(code.code).toBe(ErrorCode.NOT_FOUND);
      }
    });

    it('an unregistered purpose with disallowed format is rejected', async () => {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(null) },
        payment: { create: jest.fn(), update: jest.fn() },
      } as unknown as PrismaService;

      const service = new PaymentsService(
        prisma,
        { get: () => '3001' } as unknown as ConfigService,
        { dispatch: jest.fn() } as unknown as NotificationsService,
        {} as never,
        {} as never,
        {} as LedgerService,
        { name: 'mock-provider' } as never,
      );

      // Empty allow-list AND a string that fails the legacy regex
      // (uppercase + space) → VALIDATION_ERROR.
      service.registerAllowedPurposes([]);

      try {
        await service.initiate({
          userId: 999_999n,
          amount: 1000n,
          purpose: 'NOT A VALID PURPOSE',
          description: 'gate-test',
        });
        throw new Error('Expected VALIDATION_ERROR');
      } catch (err) {
        const code = (err as HttpException).getResponse() as { code: string };
        expect(code.code).toBe(ErrorCode.VALIDATION_ERROR);
      }
    });
  });

  // Item 7 — disabling via env flag must (a) exclude the module from app
  // imports and the loader's lifecycle, and (b) leave existing permission
  // rows untouched.
  describe('Item 7 — disabled module ships dark and never deletes permissions', () => {
    afterEach(() => {
      // Restore env between tests so other specs see the dev default.
      delete process.env.ENABLE_EXAMPLE_MODULE;
      jest.resetModules();
    });

    it('ENABLE_EXAMPLE_MODULE=false → exampleModule.enabled === false', () => {
      jest.resetModules();
      process.env.ENABLE_EXAMPLE_MODULE = 'false';
      const reloaded = jest.requireActual<{ default: typeof exampleModule }>('./index').default;
      expect(reloaded.enabled).toBe(false);
    });

    it('ENABLE_EXAMPLE_MODULE=true → exampleModule.enabled === true', () => {
      jest.resetModules();
      process.env.ENABLE_EXAMPLE_MODULE = 'true';
      const reloaded = jest.requireActual<{ default: typeof exampleModule }>('./index').default;
      expect(reloaded.enabled).toBe(true);
    });

    it('disabled modules are filtered out of registry.getEnabledModules()', () => {
      const built = buildPrisma();
      const registry = new ModuleRegistryService(
        built.prisma,
        { registerType: jest.fn() } as unknown as NotificationsService,
        { registerAllowedPurposes: jest.fn() } as unknown as PaymentsService,
      );

      // Build a module that mimics _example but is disabled.
      const disabled = { ...exampleModule, enabled: false };
      registry.register(disabled);

      expect(registry.getRegistered()).toContain(disabled);
      expect(registry.getEnabledModules()).not.toContain(disabled);
    });

    it('mergePermissions on a disabled module never calls upsert (so existing rows are preserved)', async () => {
      const { prisma, mock } = buildPrisma();
      const registry = new ModuleRegistryService(
        prisma,
        { registerType: jest.fn() } as unknown as NotificationsService,
        { registerAllowedPurposes: jest.fn() } as unknown as PaymentsService,
      );
      registry.register({ ...exampleModule, enabled: false });

      await registry.mergePermissions();
      expect(mock.permission.upsert).not.toHaveBeenCalled();
    });

    it('ModuleRegistryService source contains no delete/destroy operations on Permission', () => {
      // SECURITY: Disabling a module must never prune its historical permissions.
      // Audit and admin-shell rows that reference those codes would be orphaned,
      // and re-enabling the module would silently regrant access. The contract
      // is encoded in code: this assertion fails if anyone introduces such a
      // pruning step. Compiled output is the source of truth at runtime.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as typeof import('fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('path') as typeof import('path');
      const src = fs.readFileSync(
        path.join(__dirname, '../../core/module-registry/module-registry.service.ts'),
        'utf-8',
      );
      expect(src).not.toMatch(/permission\.delete/);
      expect(src).not.toMatch(/permission\.deleteMany/);
      expect(src).not.toMatch(/rolePermission\.delete/);
    });
  });

  // Sanity: modules.config.ts contains the example module so the gate above
  // is testing the same instance the production boot uses.
  describe('modules.config wiring', () => {
    it('MODULES contains exampleModule', () => {
      expect(MODULES).toContain(exampleModule);
    });
  });
});
