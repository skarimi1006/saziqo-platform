import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import { DEFAULT_CATEGORIES } from '../constants';

const logger = new Logger('agents:categories-bootstrap');

@Injectable()
export class CategoriesBootstrapService implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const category of DEFAULT_CATEGORIES) {
      await this.prisma.agents_category.upsert({
        where: { slug: category.slug },
        create: category,
        update: {},
      });
    }
    logger.log('[agents] categories: ensured 7 default categories');
  }
}
