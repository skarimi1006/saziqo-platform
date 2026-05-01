import { Module } from '@nestjs/common';
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
import { NotificationsModule } from './core/notifications/notifications.module';
import { PrismaModule } from './core/prisma/prisma.module';
import { RbacModule } from './core/rbac/rbac.module';
import { RedisModule } from './core/redis/redis.module';
import { UsersModule } from './core/users/users.module';
import { WalletsModule } from './core/wallets/wallets.module';

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
