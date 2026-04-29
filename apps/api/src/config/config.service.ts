import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

import type { EnvConfig } from './config.schema';

@Injectable()
export class ConfigService {
  // CLAUDE: No generic on NestConfigService — using plain string key + cast.
  // Safe because Zod validates all vars at startup; missing key = startup crash.
  constructor(private readonly nestConfig: NestConfigService) {}

  get<K extends keyof EnvConfig>(key: K): NonNullable<EnvConfig[K]> {
    return this.nestConfig.get(key as string) as NonNullable<EnvConfig[K]>;
  }

  get nodeEnv(): string {
    return this.get('NODE_ENV');
  }

  get isDevelopment(): boolean {
    return this.get('NODE_ENV') === 'development';
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }
}
