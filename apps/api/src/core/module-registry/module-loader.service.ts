import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { ErrorCode } from '../../common/types/response.types';
import { ConfigService } from '../../config/config.service';
import { AuditService } from '../audit/audit.service';
import { FILE_STORE, type FileStore } from '../files/file-store.interface';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

import { MODULES_LIST } from './module-loader.tokens';
import { ModuleRegistryService } from './module-registry.service';
import type { ModuleDeps, PlatformModule } from './types';

// CLAUDE: ModuleLoaderService is the single boot-time entry point for the
// module subsystem. It runs in OnApplicationBootstrap (after every module's
// providers are constructed but before NestJS starts accepting traffic) and
// performs four ordered steps:
//   1. registry.register(...) every entry in modules.config.ts (enabled or
//      disabled — the registry stores both so admin endpoints can list all
//      modules later, even those shipped dark).
//   2. mergePermissions / mergeNotificationTypes / mergePaymentPurposes —
//      idempotent. Disabled modules contribute nothing because the registry
//      filters them out internally.
//   3. For each enabled module: if there is no row in modules_installed,
//      run onInstall(deps) and stamp a row. The row's presence is the only
//      source of truth for "has been installed" — never reuse a name across
//      modules and never delete rows manually.
//   4. For each enabled module: run onBoot(deps).
//
// SECURITY: Boot failures are LOUD and FATAL. We never want a half-loaded
// system serving traffic with some modules silently broken. Errors are
// rethrown after logging, which causes Nest to abort startup; the process
// supervisor (Docker/Caddy) then restart-loops with the failed log visible.
@Injectable()
export class ModuleLoaderService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ModuleLoaderService.name);

  constructor(
    private readonly registry: ModuleRegistryService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(FILE_STORE) private readonly fileStore: FileStore,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    // CLAUDE: Injected via the MODULES_LIST token bound in
    // ModuleRegistryModule to MODULES from modules.config.ts. Routing
    // the array through DI keeps the loader unit-testable — tests bind
    // MODULES_LIST to a controlled array — without losing the static-
    // import type safety on the production path.
    @Inject(MODULES_LIST) private readonly modules: readonly PlatformModule[],
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.modules.length === 0) {
      this.logger.log('[module-loader] no modules registered');
    }

    for (const module of this.modules) {
      this.registry.register(module);
      this.logger.log(
        `[module-loader] registered ${module.name} v${module.version} (enabled=${module.enabled})`,
      );
    }

    await this.registry.mergePermissions();
    this.registry.mergeNotificationTypes();
    this.registry.mergePaymentPurposes();

    const deps = this.buildDeps();

    for (const module of this.registry.getEnabledModules()) {
      await this.runFirstInstallIfNeeded(module, deps);
      await this.runOnBoot(module, deps);
    }
  }

  private async runFirstInstallIfNeeded(module: PlatformModule, deps: ModuleDeps): Promise<void> {
    const existing = await this.prisma.moduleInstall.findUnique({
      where: { name: module.name },
    });
    if (existing) return;

    if (module.onInstall) {
      try {
        await module.onInstall(deps);
      } catch (err) {
        this.failBoot(module, 'onInstall', err);
      }
    }

    await this.prisma.moduleInstall.create({
      data: { name: module.name, version: module.version },
    });
    this.logger.log(`[module-loader] installed ${module.name} v${module.version}`);
  }

  private async runOnBoot(module: PlatformModule, deps: ModuleDeps): Promise<void> {
    if (!module.onBoot) return;
    try {
      await module.onBoot(deps);
    } catch (err) {
      this.failBoot(module, 'onBoot', err);
    }
  }

  private failBoot(module: PlatformModule, hook: 'onInstall' | 'onBoot', err: unknown): never {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(
      `[${ErrorCode.MODULE_BOOT_FAILED}] Module ${module.name} v${module.version} ${hook} failed: ${message}`,
      err instanceof Error ? err.stack : undefined,
    );
    throw err instanceof Error ? err : new Error(message);
  }

  private buildDeps(): ModuleDeps {
    return {
      prisma: this.prisma,
      redis: this.redis,
      fileStore: this.fileStore,
      ledger: this.ledger,
      payments: this.payments,
      notifications: this.notifications,
      audit: this.audit,
      config: this.config,
      logger: this.logger,
    };
  }
}
