import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AgentsPurchaseStatus, type agents_review } from '@prisma/client';

import { ErrorCode } from '../../../common/types/response.types';
import { NotificationsService } from '../../../core/notifications/notifications.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

import { ListingsService } from './listings.service';

export interface PostReviewInput {
  userId: bigint;
  listingId: bigint;
  rating: number;
  bodyFa?: string | null;
}

export interface UpdateReviewInput {
  userId: bigint;
  listingId: bigint;
  rating?: number;
  bodyFa?: string | null;
}

export interface ReviewDto {
  id: string;
  listingId: string;
  authorUserId: string;
  rating: number;
  bodyFa: string | null;
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
}

// CLAUDE: Reviews are gated by ownership — only buyers with a
// COMPLETED purchase can review. The unique constraint
// (listingId, authorUserId) enforces one-per-buyer at the DB level so
// a race between two POSTs cannot create two rows. POST uses upsert
// semantics so a duplicate becomes an in-place edit (rating + body
// overwrite) rather than a 409. PATCH is exposed explicitly per the
// plan and shares the same edit code path; the only behavior gap is
// that a PATCH on a non-existent review returns 404, while a POST
// creates one.
@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly notifications: NotificationsService,
  ) {}

  async post(input: PostReviewInput): Promise<ReviewDto> {
    this.assertRating(input.rating);
    const listing = await this.assertOwnership(input.userId, input.listingId);

    const isFirstReview =
      (await this.prisma.agents_review.count({
        where: { listingId: input.listingId, authorUserId: input.userId },
      })) === 0;

    const review = await this.prisma.agents_review.upsert({
      where: {
        listingId_authorUserId: {
          listingId: input.listingId,
          authorUserId: input.userId,
        },
      },
      create: {
        listingId: input.listingId,
        authorUserId: input.userId,
        rating: input.rating,
        bodyFa: input.bodyFa ?? null,
      },
      update: {
        rating: input.rating,
        bodyFa: input.bodyFa ?? null,
      },
    });

    await this.listings.recomputeRating(input.listingId);

    if (isFirstReview) {
      // Notify the maker on first review only — subsequent edits do not
      // re-notify. Fire-and-forget so a notification failure cannot
      // poison the review write.
      void this.notifications
        .dispatch({
          userId: listing.makerUserId,
          type: 'AGENTS_REVIEW_POSTED',
          payload: {
            authorName: `u.${input.userId.toString()}`,
            listingTitle: listing.titleFa,
            rating: input.rating,
          },
          channels: ['IN_APP'],
        })
        .catch((err) => this.logger.error(`AGENTS_REVIEW_POSTED dispatch failed: ${String(err)}`));
    }

    return toDto(review);
  }

  async update(input: UpdateReviewInput): Promise<ReviewDto> {
    if (input.rating !== undefined) this.assertRating(input.rating);
    await this.assertOwnership(input.userId, input.listingId);

    const existing = await this.prisma.agents_review.findUnique({
      where: {
        listingId_authorUserId: {
          listingId: input.listingId,
          authorUserId: input.userId,
        },
      },
    });
    if (!existing) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Review not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    const data: { rating?: number; bodyFa?: string | null } = {};
    if (input.rating !== undefined) data.rating = input.rating;
    if (input.bodyFa !== undefined) data.bodyFa = input.bodyFa;

    const updated = await this.prisma.agents_review.update({
      where: { id: existing.id },
      data,
    });

    if (data.rating !== undefined) {
      await this.listings.recomputeRating(input.listingId);
    }

    return toDto(updated);
  }

  async delete(input: { userId: bigint; listingId: bigint }): Promise<void> {
    const result = await this.prisma.agents_review.deleteMany({
      where: { listingId: input.listingId, authorUserId: input.userId },
    });
    if (result.count === 0) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Review not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    await this.listings.recomputeRating(input.listingId);
  }

  private assertRating(rating: number): void {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new HttpException(
        {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Rating must be an integer between 1 and 5',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async assertOwnership(
    userId: bigint,
    listingId: bigint,
  ): Promise<{ id: bigint; titleFa: string; makerUserId: bigint }> {
    const purchase = await this.prisma.agents_purchase.findFirst({
      where: { userId, listingId, status: AgentsPurchaseStatus.COMPLETED },
      select: { id: true },
    });
    if (!purchase) {
      throw new HttpException(
        {
          code: ErrorCode.ACCESS_DENIED_NOT_OWNER,
          message: 'You can only review listings you have purchased',
        },
        HttpStatus.FORBIDDEN,
      );
    }
    const listing = await this.prisma.agents_listing.findFirst({
      where: { id: listingId, deletedAt: null },
      select: { id: true, titleFa: true, makerUserId: true },
    });
    if (!listing) {
      throw new HttpException(
        { code: ErrorCode.LISTING_NOT_FOUND, message: 'Listing not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return listing;
  }
}

function toDto(row: agents_review): ReviewDto {
  return {
    id: row.id.toString(),
    listingId: row.listingId.toString(),
    authorUserId: row.authorUserId.toString(),
    rating: row.rating,
    bodyFa: row.bodyFa,
    isHidden: row.isHidden,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
