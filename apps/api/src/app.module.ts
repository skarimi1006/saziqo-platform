import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { DiagnosticsModule } from './_diagnostics/diagnostics.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { PinoLoggerModule } from './common/middleware/logger.middleware';
import { RateLimitGuard } from './common/middleware/rate-limit.middleware';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './core/prisma/prisma.module';
import { RedisModule } from './core/redis/redis.module';

@Module({
  imports: [PinoLoggerModule, ConfigModule, PrismaModule, RedisModule, DiagnosticsModule],
  providers: [
    // Global interceptor: wraps every successful return into { data, meta? }.
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    // Global filter: maps every exception to the canonical { error } envelope.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Global guard: per-route + default rate limiting via Redis sliding window.
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
