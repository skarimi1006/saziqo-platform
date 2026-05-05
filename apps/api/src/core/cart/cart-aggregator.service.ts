import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { CartAdapter, CartLineDescriptor } from './cart.types';

@Injectable()
export class CartAggregatorService {
  private readonly logger = new Logger(CartAggregatorService.name);
  private readonly adapters = new Map<string, CartAdapter>();

  registerAdapter(adapter: CartAdapter): void {
    this.adapters.set(adapter.moduleSource, adapter);
    this.logger.log(`[cart] registered adapter for module '${adapter.moduleSource}'`);
  }

  async getForUser(userId: bigint): Promise<CartLineDescriptor[]> {
    const results = await Promise.all(
      Array.from(this.adapters.values()).map((a) => a.getForUser(userId)),
    );
    return results.flat();
  }

  async removeItem(userId: bigint, moduleSource: string, moduleItemId: string): Promise<void> {
    const adapter = this.adapters.get(moduleSource);
    if (!adapter) {
      throw new NotFoundException(`No cart adapter registered for module '${moduleSource}'`);
    }
    await adapter.removeItem(userId, moduleItemId);
  }

  async clearForUser(userId: bigint): Promise<void> {
    await Promise.all(Array.from(this.adapters.values()).map((a) => a.clearForUser(userId)));
  }

  getRegisteredModuleSources(): string[] {
    return Array.from(this.adapters.keys()).sort();
  }
}
