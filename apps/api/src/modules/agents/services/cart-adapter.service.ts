import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { CartAggregatorService } from '../../../core/cart/cart-aggregator.service';
import type { CartAdapter, CartLineDescriptor } from '../../../core/cart/cart.types';
import { PrismaService } from '../../../core/prisma/prisma.service';

const logger = new Logger('agents:cart-adapter');

@Injectable()
export class AgentsCartAdapterService implements CartAdapter, OnApplicationBootstrap {
  readonly moduleSource = 'agents';

  constructor(
    private readonly prisma: PrismaService,
    private readonly cartAggregator: CartAggregatorService,
  ) {}

  onApplicationBootstrap(): void {
    this.cartAggregator.registerAdapter(this);
    logger.log('[agents] cart adapter registered');
  }

  async getForUser(userId: bigint): Promise<CartLineDescriptor[]> {
    const items = await this.prisma.agents_cart_item.findMany({
      where: { userId },
      include: {
        listing: {
          select: {
            id: true,
            slug: true,
            titleFa: true,
            pricingType: true,
            oneTimePriceToman: true,
          },
        },
        runPack: {
          select: { id: true, priceToman: true, nameFa: true },
        },
      },
      orderBy: { addedAt: 'asc' },
    });

    return items.map((item) => {
      let priceToman: bigint;
      if (item.listing.pricingType === 'FREE') {
        priceToman = BigInt(0);
      } else if (item.listing.pricingType === 'ONE_TIME') {
        priceToman = item.listing.oneTimePriceToman ?? BigInt(0);
      } else {
        priceToman = item.runPack?.priceToman ?? BigInt(0);
      }

      return {
        moduleSource: 'agents',
        moduleItemId: item.id.toString(),
        titleFa: item.listing.titleFa,
        priceToman,
        metadata: {
          listingId: item.listing.id,
          runPackId: item.runPackId ?? null,
          pricingType: item.listing.pricingType,
          slug: item.listing.slug,
        },
      };
    });
  }

  async removeItem(userId: bigint, moduleItemId: string): Promise<void> {
    await this.prisma.agents_cart_item.deleteMany({
      where: { id: BigInt(moduleItemId), userId },
    });
  }

  async clearForUser(userId: bigint): Promise<void> {
    await this.prisma.agents_cart_item.deleteMany({ where: { userId } });
  }
}
