import { Global, Module } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { MODULES } from '../../modules.config';
import { LedgerModule } from '../ledger/ledger.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AdminRegistryController } from './admin-registry.controller';
import { ModuleLoaderService } from './module-loader.service';
import { MODULES_LIST } from './module-loader.tokens';
import { ModuleRegistryService } from './module-registry.service';

// CLAUDE: Global so the Phase-11B loader and any future admin endpoint
// (Phase 19F enable/disable UI) can inject the same registry instance
// without each module having to import this module explicitly.
//
// The loader pulls every concrete service it needs to build ModuleDeps:
// PrismaModule, NotificationsModule, PaymentsModule, LedgerModule are
// imported here directly. RedisModule, FilesModule, AuditModule, and
// ConfigModule are @Global so they're available without an explicit
// import.
//
// MODULES_LIST is bound here to the static MODULES array exported by
// apps/api/src/modules.config.ts. The loader consumes it via DI rather
// than importing the constant directly so tests can rebind it without
// playing module-cache games.
@Global()
@Module({
  imports: [PrismaModule, NotificationsModule, PaymentsModule, LedgerModule],
  controllers: [AdminRegistryController],
  providers: [
    ModuleRegistryService,
    ModuleLoaderService,
    { provide: MODULES_LIST, useValue: MODULES },
    JwtAuthGuard,
    PermissionGuard,
  ],
  exports: [ModuleRegistryService, ModuleLoaderService],
})
export class ModuleRegistryModule {}
