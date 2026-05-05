import { Controller, Get } from '@nestjs/common';
import { z } from 'zod';

import { Public } from '../../../common/decorators/public.decorator';
import { ZodQuery } from '../../../common/decorators/zod-query.decorator';
import { listingToCardDto, type ListingCardDto } from '../dto/listing-card.dto';
import { ListingsService } from '../services/listings.service';

const CatalogQuerySchema = z.object({
  categoryId: z.coerce.bigint().optional(),
  pricingType: z.enum(['FREE', 'ONE_TIME', 'PER_RUN']).optional(),
  freeOnly: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  minRating: z.coerce.number().int().min(1).max(5).optional(),
  cursor: z.coerce.bigint().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(['newest', 'most-installed', 'top-rated']).default('most-installed'),
});

type CatalogQuery = z.infer<typeof CatalogQuerySchema>;

interface CatalogResponse {
  data: ListingCardDto[];
  meta: { nextCursor: string | null; hasMore: boolean };
}

@Controller('agents')
export class CatalogController {
  constructor(private readonly listingsService: ListingsService) {}

  @Get('catalog')
  @Public()
  async getCatalog(@ZodQuery(CatalogQuerySchema) query: CatalogQuery): Promise<CatalogResponse> {
    const { items, nextCursor, hasMore } = await this.listingsService.findPublished({
      filters: {
        categoryId: query.categoryId,
        pricingType: query.pricingType,
        freeOnly: query.freeOnly,
        minRating: query.minRating,
      },
      cursor: query.cursor,
      limit: query.limit,
      sort: query.sort,
    });

    return {
      data: items.map(listingToCardDto),
      meta: { nextCursor: nextCursor?.toString() ?? null, hasMore },
    };
  }
}
