import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { validateEnv } from './config.schema';
import { ConfigService } from './config.service';

// CLAUDE: envFilePath tries root .env first (monorepo dev: ../../.env relative
// to apps/api/ CWD), then falls back to a local .env for isolated runs.
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      validate: validateEnv,
      expandVariables: false,
    }),
  ],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
