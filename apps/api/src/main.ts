import 'reflect-metadata';
import './common/bigint-serialization';

import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { Logger as PinoLoggerService } from 'nestjs-pino';

import { AppModule } from './app.module';
import { createCorsConfig } from './common/middleware/cors.config';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { createSecurityHeadersMiddleware } from './common/middleware/security-headers.middleware';
import { ConfigService } from './config/config.service';

async function bootstrap(): Promise<void> {
  // bufferLogs replays NestFactory's startup logs through the Pino logger
  // once useLogger() is called below.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.setGlobalPrefix('api/v1');

  // Replace NestJS's default ConsoleLogger with the Pino-backed one.
  app.useLogger(app.get(PinoLoggerService));

  // Middleware chain — order is security-critical:
  //   request-id → (pino-http via nestjs-pino auto-mw) → security headers → CORS
  // Globals (interceptor, filter, guard) are registered as APP_X providers
  // in AppModule so they apply identically in production and in tests.
  app.use(cookieParser());
  const requestIdMw = new RequestIdMiddleware();
  app.use(requestIdMw.use.bind(requestIdMw));

  const config = app.get(ConfigService);
  app.use(createSecurityHeadersMiddleware(config.isProduction));
  app.enableCors(createCorsConfig(config.corsAllowedOrigins));

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
