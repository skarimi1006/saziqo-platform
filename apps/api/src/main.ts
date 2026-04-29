import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');

  const config = app.get(ConfigService);
  const port = config.get('PORT_API');

  await app.listen(port);
  console.log(`API listening on http://localhost:${port}/api/v1`);
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal: failed to start API server', err);
  process.exit(1);
});
