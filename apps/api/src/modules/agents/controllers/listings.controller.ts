import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { Public } from '../../../common/decorators/public.decorator';
import { RateLimit } from '../../../common/decorators/rate-limit.decorator';
import { type AuthenticatedUser } from '../../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../../common/guards/optional-jwt-auth.guard';
import { ErrorCode } from '../../../common/types/response.types';
import type { ListingDetailDto } from '../dto/listing-detail.dto';
import { ListingsService } from '../services/listings.service';

type OptionalAuthRequest = Request & { user?: AuthenticatedUser };

@Controller('agents')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  // CLAUDE: Public route. OptionalJwtAuthGuard populates req.user if a
  // valid Bearer token is sent; otherwise the call serves as anonymous.
  // Returns 404 for any non-PUBLISHED slug — admins use a separate
  // admin-only endpoint to read drafts/rejections (Phase 5).
  @Get('listings/:slug')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  async getListingDetail(
    @Param('slug') slug: string,
    @Req() req: OptionalAuthRequest,
  ): Promise<ListingDetailDto> {
    const detail = await this.listingsService.findDetailBySlug(slug, req.user?.id);
    if (!detail) {
      throw new HttpException(
        { code: ErrorCode.LISTING_NOT_FOUND, message: 'Listing not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return detail;
  }

  // Fire-and-forget sampled view increment. Always returns 204 regardless
  // of whether the slug exists — callers must not rely on this for truth.
  @Post('listings/:slug/view')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ ip: '120/min' })
  async recordView(@Param('slug') slug: string): Promise<void> {
    void this.listingsService.recordView(slug, Math.random());
  }
}
