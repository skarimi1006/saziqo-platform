import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger as PinoLoggerService } from 'nestjs-pino';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { createCorsConfig } from './common/middleware/cors.config';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { createSecurityHeadersMiddleware } from './common/middleware/security-headers.middleware';
import { ConfigService } from './config/config.service';

// SECURITY: Prisma uses BigInt for primary keys but JSON.stringify cannot
// serialize BigInt natively. Convert to string in HTTP responses; consumers
// should treat IDs as opaque strings, not numbers (precision loss > 2^53).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function (): string {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  // bufferLogs replays NestFactory's startup logs through the Pino logger
  // once useLogger() is called below.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.setGlobalPrefix('api/v1');

  // Replace NestJS's default ConsoleLogger with the Pino-backed one.
  app.useLogger(app.get(PinoLoggerService));

  // Middleware chain — order is security-critical:
  //   request-id → (pino-http via nestjs-pino auto-mw) → security headers → CORS
  // pino-http logs on response 'finish', so it picks up req.requestId
  // even though the auto-mw is wired before RequestIdMiddleware.
  // Adding rate-limit, auth, RBAC, audit happens in later phases between
  // CORS and the route handler.
  const requestIdMw = new RequestIdMiddleware();
  app.use(requestIdMw.use.bind(requestIdMw));

  const config = app.get(ConfigService);
  app.use(createSecurityHeadersMiddleware(config.isProduction));
  app.enableCors(createCorsConfig(config.corsAllowedOrigins));

  // Global response shape and error envelope (Phase 2C).
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = config.get('PORT_API');
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}/api/v1`);
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Fatal: failed to start API server', err);
  process.exit(1);
});
