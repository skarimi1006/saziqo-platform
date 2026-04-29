import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { PinoLoggerModule } from './common/middleware/logger.middleware';
import { RateLimitGuard } from './common/middleware/rate-limit.middleware';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './core/health/health.module';
import { PrismaModule } from './core/prisma/prisma.module';
import { RbacModule } from './core/rbac/rbac.module';
import { RedisModule } from './core/redis/redis.module';
import { UsersModule } from './core/users/users.module';

// CLAUDE: APP_INTERCEPTOR providers are applied in declaration order — the
// first declared is OUTERMOST. We want IdempotencyInterceptor to wrap the
// already-wrapped { data, meta? } envelope produced by ResponseInterceptor,
// so Idempotency goes first (outer), Response second (inner).
@Module({
  imports: [
    PinoLoggerModule,
    ConfigModule,
    PrismaModule,
    RedisModule,
    RbacModule,
    HealthModule,
    UsersModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
