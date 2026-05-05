import { Controller, Get } from '@nestjs/common';

import { Public } from '../../../common/decorators/public.decorator';
import type { ListingCardDto } from '../dto/listing-card.dto';
import type { RecentActivityItem } from '../dto/section.dto';
import { ListingsService } from '../services/listings.service';

@Controller('agents')
export class SectionsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Get('featured')
  @Public()
  async getFeatured(): Promise<{ data: ListingCardDto[] }> {
    const items = await this.listingsService.findFeatured();
    return { data: items };
  }

  @Get('best-sellers')
  @Public()
  async getBestSellers(): Promise<{ data: ListingCardDto[] }> {
    const items = await this.listingsService.findBestSellers();
    return { data: items };
  }

  @Get('new-releases')
  @Public()
  async getNewReleases(): Promise<{ data: ListingCardDto[] }> {
    const items = await this.listingsService.findNewReleases();
    return { data: items };
  }

  @Get('recent-activity')
  @Public()
  async getRecentActivity(): Promise<{ data: RecentActivityItem[] }> {
    const items = await this.listingsService.findRecentActivity();
    return { data: items };
  }
}
