import { Module, type Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { PinoLoggerModule } from './common/middleware/logger.middleware';
import { RateLimitGuard } from './common/middleware/rate-limit.middleware';
import { ConfigModule } from './config/config.module';
import { AuditModule } from './core/audit/audit.module';
import { FilesModule } from './core/files/files.module';
import { HealthModule } from './core/health/health.module';
import { ImpersonationModule } from './core/impersonation/impersonation.module';
import { ModuleRegistryModule } from './core/module-registry/module-registry.module';
import { NotificationsModule } from './core/notifications/notifications.module';
import { PaymentsModule } from './core/payments/payments.module';
import { PayoutsModule } from './core/payouts/payouts.module';
import { PrismaModule } from './core/prisma/prisma.module';
import { RbacModule } from './core/rbac/rbac.module';
import { RedisModule } from './core/redis/redis.module';
import { UsersModule } from './core/users/users.module';
import { WalletsModule } from './core/wallets/wallets.module';
import { MODULES } from './modules.config';

// CLAUDE: Module-loading pattern for future Claude sessions.
//
// Every business module listed in modules.config.ts exposes a
// registerNestModule() method that returns its NestJS @Module() class.
// We collect the classes for *enabled* modules at file-evaluation time
// and append them to AppModule's imports array. The order of operations
// is:
//
//   1. modules.config.ts is statically imported above. Its top-level
//      imports run, which constructs each module's default-exported
//      PlatformModule instance.
//   2. ENABLED_MODULE_IMPORTS is computed once, when this file is first
//      evaluated. Disabled modules (enabled: false) are filtered out
//      here AND skipped by ModuleLoaderService at boot — they ship
//      truly dark, with no routes mounted and no lifecycle hooks fired.
//   3. NestJS reads the @Module() decorator metadata below and wires
//      the DI graph. Every business module gets the same treatment as
//      a core module because it's a peer entry in `imports`.
//   4. Once the graph is constructed, ModuleLoaderService's
//      OnApplicationBootstrap hook runs to merge metadata
//      (permissions, notification types, payment purposes), run
//      onInstall on first boot, and call onBoot. See
//      core/module-registry/module-loader.service.ts for that flow.
//
// To add a new module: extend modules.config.ts. Do NOT add the module
// class directly to the imports array below — modules.config.ts is the
// single source of truth.
const ENABLED_MODULE_IMPORTS: Type<unknown>[] = MODULES.filter((m) => m.enabled).map((m) =>
  m.registerNestModule(),
);

// CLAUDE: APP_INTERCEPTOR providers are applied in declaration order — the
// first declared is OUTERMOST. The runtime request flow is therefore:
//   Audit (outermost) → Idempotency → Response → handler
// On the response side it reverses, so Response wraps the raw return into
// { data, meta? }, Idempotency caches that wrapped envelope, and Audit
// finally observes the wrapped + idempotency-resolved value to write its
// row. Audit is OUTSIDE Idempotency so cache hits are still audited as
// attempts (the alternative would create blind spots whenever a client
// retries with the same Idempotency-Key).
@Module({
  imports: [
    PinoLoggerModule,
    ConfigModule,
    PrismaModule,
    RedisModule,
    RbacModule,
    AuditModule,
    FilesModule,
    HealthModule,
    UsersModule,
    ImpersonationModule,
    NotificationsModule,
    WalletsModule,
    PayoutsModule,
    PaymentsModule,
    ModuleRegistryModule,
    ...ENABLED_MODULE_IMPORTS,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
