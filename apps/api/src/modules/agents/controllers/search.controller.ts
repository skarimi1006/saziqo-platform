import { Controller, Get } from '@nestjs/common';
import { z } from 'zod';

import { Public } from '../../../common/decorators/public.decorator';
import { RateLimit } from '../../../common/decorators/rate-limit.decorator';
import { ZodQuery } from '../../../common/decorators/zod-query.decorator';
import { listingToCardDto, type ListingCardDto } from '../dto/listing-card.dto';
import { ListingsService } from '../services/listings.service';

const SearchQuerySchema = z.object({
  q: z.string().min(2).max(200),
  categoryId: z.coerce.bigint().optional(),
  pricingType: z.enum(['FREE', 'ONE_TIME', 'PER_RUN']).optional(),
  freeOnly: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  minRating: z.coerce.number().int().min(1).max(5).optional(),
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

type SearchQuery = z.infer<typeof SearchQuerySchema>;

interface SearchResponse {
  data: ListingCardDto[];
  meta: { nextCursor: string | null; hasMore: boolean };
}

@Controller('agents')
export class SearchController {
  constructor(private readonly listingsService: ListingsService) {}

  // Search uses an offset-based numeric cursor: rank-ordered results have
  // no natural id boundary that survives reordering on later pages.
  @Get('search')
  @Public()
  @RateLimit({ ip: '60/min' })
  async search(@ZodQuery(SearchQuerySchema) query: SearchQuery): Promise<SearchResponse> {
    const { items, nextOffset, hasMore } = await this.listingsService.searchPublished({
      q: query.q,
      filters: {
        categoryId: query.categoryId,
        pricingType: query.pricingType,
        freeOnly: query.freeOnly,
        minRating: query.minRating,
      },
      offset: query.cursor,
      limit: query.limit,
    });

    return {
      data: items.map(listingToCardDto),
      meta: { nextCursor: nextOffset?.toString() ?? null, hasMore },
    };
  }
}
