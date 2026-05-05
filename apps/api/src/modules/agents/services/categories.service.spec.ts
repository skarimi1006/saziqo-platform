import { Test } from '@nestjs/testing';

import { PrismaService } from '../../../core/prisma/prisma.service';
import { RedisService } from '../../../core/redis/redis.service';

import { CategoriesService, type CategoryPublicDto } from './categories.service';

interface RawRow {
  id: bigint;
  slug: string;
  nameFa: string;
  iconKey: string;
  colorToken: string;
  order: number;
  listing_count: bigint;
}

const CATEGORY_FIXTURES: RawRow[] = [
  {
    id: 1n,
    slug: 'research',
    nameFa: 'پژوهش',
    iconKey: 'flask',
    colorToken: 'lavender',
    order: 10,
    listing_count: 3n,
  },
  {
    id: 2n,
    slug: 'business',
    nameFa: 'کسب و کار',
    iconKey: 'briefcase',
    colorToken: 'mint',
    order: 20,
    listing_count: 1n,
  },
];

describe('CategoriesService', () => {
  let service: CategoriesService;
  let queryRawMock: jest.Mock;
  let redisGet: jest.Mock;
  let redisSetex: jest.Mock;
  let redisDel: jest.Mock;

  beforeEach(async () => {
    queryRawMock = jest.fn(async () => CATEGORY_FIXTURES);
    redisGet = jest.fn(async () => null);
    redisSetex = jest.fn(async () => 'OK');
    redisDel = jest.fn(async () => 1);

    const moduleRef = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: PrismaService, useValue: { $queryRaw: queryRawMock } },
        {
          provide: RedisService,
          useValue: {
            getClient: () => ({ get: redisGet, setex: redisSetex, del: redisDel }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(CategoriesService);
  });

  // ─── findAllPublic ────────────────────────────────────────────────

  describe('findAllPublic', () => {
    it('queries DB and returns all active categories with listing counts on cache miss', async () => {
      const result = await service.findAllPublic();

      expect(queryRawMock).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ slug: 'research', listingCount: 3 });
      expect(result[1]).toMatchObject({ slug: 'business', listingCount: 1 });
    });

    it('serialises BigInt id as string', async () => {
      const result = await service.findAllPublic();
      expect(typeof result[0]!.id).toBe('string');
      expect(result[0]!.id).toBe('1');
    });

    it('stores result in Redis with 5-minute TTL', async () => {
      await service.findAllPublic();
      expect(redisSetex).toHaveBeenCalledWith('agents:categories:public', 300, expect.any(String));
      const stored = JSON.parse(redisSetex.mock.calls[0][2] as string) as CategoryPublicDto[];
      expect(stored[0]!.listingCount).toBe(3);
    });

    it('returns cached value without hitting DB on cache hit', async () => {
      const cached: CategoryPublicDto[] = [
        {
          id: '1',
          slug: 'research',
          nameFa: 'پژوهش',
          iconKey: 'flask',
          colorToken: 'lavender',
          order: 10,
          listingCount: 7,
        },
      ];
      redisGet.mockResolvedValueOnce(JSON.stringify(cached));

      const result = await service.findAllPublic();

      expect(queryRawMock).not.toHaveBeenCalled();
      expect(result).toEqual(cached);
    });

    it('SQL filters counts to PUBLISHED and non-deleted listings', async () => {
      await service.findAllPublic();
      const sqlParts = queryRawMock.mock.calls[0]?.[0] as readonly string[];
      const sql = sqlParts.join('');
      expect(sql).toContain("'PUBLISHED'");
      expect(sql).toContain('"deletedAt"');
      expect(sql).toContain('FILTER');
    });

    it('SQL orders by c."order" ASC and filters c."isActive" = true', async () => {
      await service.findAllPublic();
      const sqlParts = queryRawMock.mock.calls[0]?.[0] as readonly string[];
      const sql = sqlParts.join('');
      expect(sql).toContain('"isActive"');
      expect(sql).toContain('"order"');
      expect(sql).toContain('ORDER BY');
    });

    // Verifies that counts reflect current listing status: after invalidation,
    // a re-query picks up listings that transitioned to PUBLISHED.
    it('counts update correctly when listings change status (cache-bust path)', async () => {
      // Initial state: research has 3 published listings.
      const first = await service.findAllPublic();
      expect(first[0]!.listingCount).toBe(3);
      expect(queryRawMock).toHaveBeenCalledTimes(1);

      // A new listing is published → invalidate cache (mirrors what ListingsService does).
      await service.invalidateCache();
      expect(redisDel).toHaveBeenCalledWith('agents:categories:public');

      // Next read: cache is empty, DB returns updated count (4 published now).
      const updatedFixtures: RawRow[] = [
        { ...CATEGORY_FIXTURES[0]!, listing_count: 4n },
        { ...CATEGORY_FIXTURES[1]! },
      ];
      queryRawMock.mockResolvedValueOnce(updatedFixtures);
      redisGet.mockResolvedValueOnce(null);

      const second = await service.findAllPublic();
      expect(queryRawMock).toHaveBeenCalledTimes(2);
      expect(second[0]!.listingCount).toBe(4);
    });

    it('does not include DRAFT or SUSPENDED listings in listing_count', async () => {
      // The FILTER clause ensures only PUBLISHED + non-deleted rows are counted;
      // categories with zero qualifying listings return listingCount = 0.
      queryRawMock.mockResolvedValueOnce([{ ...CATEGORY_FIXTURES[0]!, listing_count: 0n }]);

      const result = await service.findAllPublic();
      expect(result[0]!.listingCount).toBe(0);
    });
  });

  // ─── invalidateCache ──────────────────────────────────────────────

  describe('invalidateCache', () => {
    it('deletes the cache key from Redis', async () => {
      await service.invalidateCache();
      expect(redisDel).toHaveBeenCalledWith('agents:categories:public');
    });

    it('does not throw on Redis error', async () => {
      redisDel.mockRejectedValueOnce(new Error('Redis unavailable'));
      await expect(service.invalidateCache()).resolves.toBeUndefined();
    });
  });
});
