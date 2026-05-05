import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../core/prisma/prisma.service';
import { RedisService } from '../../../core/redis/redis.service';

const CACHE_KEY = 'agents:categories:public';
const CACHE_TTL_S = 300;

export interface CategoryPublicDto {
  id: string;
  slug: string;
  nameFa: string;
  iconKey: string;
  colorToken: string;
  order: number;
  listingCount: number;
}

interface RawCategoryRow {
  id: bigint;
  slug: string;
  nameFa: string;
  iconKey: string;
  colorToken: string;
  order: number;
  listing_count: bigint;
}

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async findAllPublic(): Promise<CategoryPublicDto[]> {
    const client = this.redis.getClient();
    const hit = await client.get(CACHE_KEY);
    if (hit !== null) return JSON.parse(hit) as CategoryPublicDto[];

    const rows = await this.prisma.$queryRaw<RawCategoryRow[]>`
      SELECT c.id, c.slug, c."nameFa", c."iconKey", c."colorToken", c."order",
        COUNT(l.id) FILTER (WHERE l.status = 'PUBLISHED' AND l."deletedAt" IS NULL) AS listing_count
      FROM agents_category c
      LEFT JOIN agents_listing l ON l."categoryId" = c.id
      WHERE c."isActive" = true
      GROUP BY c.id
      ORDER BY c."order" ASC
    `;

    const result: CategoryPublicDto[] = rows.map((r) => ({
      id: r.id.toString(),
      slug: r.slug,
      nameFa: r.nameFa,
      iconKey: r.iconKey,
      colorToken: r.colorToken,
      order: r.order,
      listingCount: Number(r.listing_count),
    }));

    await client.setex(CACHE_KEY, CACHE_TTL_S, JSON.stringify(result));
    return result;
  }

  async invalidateCache(): Promise<void> {
    try {
      await this.redis.getClient().del(CACHE_KEY);
    } catch (err) {
      this.logger.error(`Categories cache invalidation failed: ${String(err)}`);
    }
  }
}
