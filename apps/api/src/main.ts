import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { ConfigService } from './config/config.service';

// SECURITY: Prisma uses BigInt for primary keys but JSON.stringify cannot
// serialize BigInt natively. Convert to string in HTTP responses; consumers
// should treat IDs as opaque strings, not numbers (precision loss > 2^53).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function (): string {
  return this.toString();
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');

  // Order matters: filter catches errors thrown anywhere in the chain,
  // including from the interceptor's stream. Both registered globally.
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  const config = app.get(ConfigService);
  const port = config.get('PORT_API');

  await app.listen(port);
  console.log(`API listening on http://localhost:${port}/api/v1`);
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal: failed to start API server', err);
  process.exit(1);
});
