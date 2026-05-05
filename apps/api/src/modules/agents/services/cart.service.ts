import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  AgentsListingStatus,
  AgentsPricingType,
  AgentsPurchaseStatus,
  Prisma,
  type agents_cart_item,
} from '@prisma/client';

import { ErrorCode } from '../../../common/types/response.types';
import { PrismaService } from '../../../core/prisma/prisma.service';

export interface AddItemInput {
  listingId: bigint;
  runPackId?: bigint | null;
}

export interface MergeFailure {
  listingId: string;
  runPackId: string | null;
  reason: ErrorCode;
}

export interface MergeResult {
  merged: number;
  failed: MergeFailure[];
}

// CLAUDE: Hybrid cart per locked decision 5 — guests keep cart in
// localStorage, then POST /cart/merge with the array on login. addItem
// re-validates every item against the live catalog so a listing that has
// been suspended or pulled since being added cannot sneak into the DB
// cart. The unique constraint (userId, listingId, runPackId) is what
// makes upsert idempotent for FREE/ONE_TIME duplicates; PER_RUN with a
// distinct pack always becomes a separate row.
@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(private readonly prisma: PrismaService) {}

  async addItem(userId: bigint, input: AddItemInput): Promise<agents_cart_item> {
    const listing = await this.prisma.agents_listing.findFirst({
      where: { id: input.listingId, deletedAt: null },
      select: {
        id: true,
        status: true,
        pricingType: true,
        makerUserId: true,
      },
    });

    if (!listing) {
      throw cartError(ErrorCode.LISTING_NOT_FOUND, 'Listing not found', HttpStatus.NOT_FOUND);
    }
    if (listing.status !== AgentsListingStatus.PUBLISHED) {
      throw cartError(
        ErrorCode.LISTING_NOT_PURCHASABLE,
        'Listing is not currently purchasable',
        HttpStatus.CONFLICT,
      );
    }

    if (listing.makerUserId === userId) {
      throw cartError(
        ErrorCode.CANNOT_BUY_OWN_LISTING,
        'You cannot purchase your own listing',
        HttpStatus.CONFLICT,
      );
    }

    let runPackId: bigint | null = null;
    if (listing.pricingType === AgentsPricingType.PER_RUN) {
      if (input.runPackId === undefined || input.runPackId === null) {
        throw cartError(
          ErrorCode.INVALID_RUN_PACK,
          'A run pack is required for PER_RUN listings',
          HttpStatus.BAD_REQUEST,
        );
      }
      const pack = await this.prisma.agents_run_pack.findFirst({
        where: { id: input.runPackId, listingId: listing.id, isActive: true },
        select: { id: true },
      });
      if (!pack) {
        throw cartError(
          ErrorCode.INVALID_RUN_PACK,
          'Run pack does not belong to this listing or is inactive',
          HttpStatus.BAD_REQUEST,
        );
      }
      runPackId = pack.id;
    } else {
      // FREE / ONE_TIME: ownership is permanent — block re-adding if
      // already purchased.
      const existing = await this.prisma.agents_purchase.findFirst({
        where: {
          userId,
          listingId: listing.id,
          status: AgentsPurchaseStatus.COMPLETED,
        },
        select: { id: true },
      });
      if (existing) {
        throw cartError(
          ErrorCode.ALREADY_OWNED,
          'You already own this listing',
          HttpStatus.CONFLICT,
        );
      }
    }

    // CLAUDE: A duplicate add must be a no-op rather than a 409. The
    // unique constraint (userId, listingId, runPackId) includes a nullable
    // runPackId, which prevents Prisma's upsert composite-key form from
    // matching FREE/ONE_TIME lines (NULL pack). Using findFirst + create
    // wrapped in P2002 recovery handles all three pricing types uniformly
    // — and matches the cumulative-pack behavior (locked decision 7):
    // the cart never stacks identical pack lines; the buyer increments
    // their balance by re-purchasing the pack after checkout.
    const existing = await this.prisma.agents_cart_item.findFirst({
      where: { userId, listingId: listing.id, runPackId },
    });
    if (existing) return existing;

    try {
      return await this.prisma.agents_cart_item.create({
        data: { userId, listingId: listing.id, runPackId },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const racedRow = await this.prisma.agents_cart_item.findFirst({
          where: { userId, listingId: listing.id, runPackId },
        });
        if (racedRow) return racedRow;
      }
      throw err;
    }
  }

  async removeItem(userId: bigint, cartItemId: bigint): Promise<void> {
    const result = await this.prisma.agents_cart_item.deleteMany({
      where: { id: cartItemId, userId },
    });
    if (result.count === 0) {
      throw cartError(ErrorCode.NOT_FOUND, 'Cart item not found', HttpStatus.NOT_FOUND);
    }
  }

  async clearForUser(userId: bigint): Promise<void> {
    await this.prisma.agents_cart_item.deleteMany({ where: { userId } });
  }

  async mergeGuestCart(userId: bigint, items: AddItemInput[]): Promise<MergeResult> {
    let merged = 0;
    const failed: MergeFailure[] = [];

    for (const item of items) {
      try {
        await this.addItem(userId, item);
        merged += 1;
      } catch (err) {
        const reason = extractErrorCode(err);
        failed.push({
          listingId: item.listingId.toString(),
          runPackId:
            item.runPackId !== undefined && item.runPackId !== null
              ? item.runPackId.toString()
              : null,
          reason,
        });
        this.logger.debug(`merge skipped listing=${item.listingId.toString()} reason=${reason}`);
      }
    }

    return { merged, failed };
  }
}

function cartError(code: ErrorCode, message: string, status: HttpStatus): HttpException {
  return new HttpException({ code, message }, status);
}

function extractErrorCode(err: unknown): ErrorCode {
  if (err instanceof HttpException) {
    const response = err.getResponse();
    if (
      typeof response === 'object' &&
      response !== null &&
      'code' in response &&
      typeof (response as { code: unknown }).code === 'string'
    ) {
      return (response as { code: ErrorCode }).code;
    }
  }
  return ErrorCode.INTERNAL_ERROR;
}
