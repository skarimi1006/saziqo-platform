import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import { DEFAULT_AGENTS_SETTINGS } from '../constants';

const logger = new Logger('agents:settings-bootstrap');

@Injectable()
export class SettingsBootstrapService implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.prisma.agents_settings.upsert({
      where: { id: BigInt(1) },
      create: { id: BigInt(1), ...DEFAULT_AGENTS_SETTINGS },
      update: {},
    });
    logger.log('[agents] settings: ensured singleton row');
  }
}
