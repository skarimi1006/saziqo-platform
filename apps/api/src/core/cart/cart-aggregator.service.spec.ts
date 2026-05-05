import { NotFoundException } from '@nestjs/common';

import { CartAggregatorService } from './cart-aggregator.service';
import type { CartAdapter, CartLineDescriptor } from './cart.types';

function makeMockAdapter(
  moduleSource: string,
  lines: CartLineDescriptor[] = [],
): jest.Mocked<CartAdapter> {
  return {
    moduleSource,
    getForUser: jest.fn().mockResolvedValue(lines),
    removeItem: jest.fn().mockResolvedValue(undefined),
    clearForUser: jest.fn().mockResolvedValue(undefined),
  };
}

function makeLine(overrides: Partial<CartLineDescriptor> = {}): CartLineDescriptor {
  return {
    moduleSource: 'agents',
    moduleItemId: '1',
    titleFa: 'ایجنت نمونه',
    priceToman: BigInt(50000),
    metadata: {},
    ...overrides,
  };
}

describe('CartAggregatorService', () => {
  let service: CartAggregatorService;

  beforeEach(() => {
    service = new CartAggregatorService();
  });

  describe('registerAdapter', () => {
    it('registers an adapter without error', () => {
      const adapter = makeMockAdapter('agents');
      expect(() => service.registerAdapter(adapter)).not.toThrow();
    });

    it('overwrites a previously registered adapter for the same module', async () => {
      const first = makeMockAdapter('agents', [makeLine({ moduleItemId: '1' })]);
      const second = makeMockAdapter('agents', [makeLine({ moduleItemId: '2' })]);
      service.registerAdapter(first);
      service.registerAdapter(second);

      const lines = await service.getForUser(BigInt(1));
      expect(lines).toHaveLength(1);
      expect(lines[0]?.moduleItemId).toBe('2');
    });
  });

  describe('getForUser', () => {
    it('returns empty array when no adapters registered', async () => {
      const result = await service.getForUser(BigInt(1));
      expect(result).toEqual([]);
    });

    it('returns lines from a single adapter', async () => {
      const line = makeLine();
      service.registerAdapter(makeMockAdapter('agents', [line]));
      const result = await service.getForUser(BigInt(1));
      expect(result).toEqual([line]);
    });

    it('aggregates lines from multiple adapters', async () => {
      const agentsLine = makeLine({ moduleSource: 'agents', moduleItemId: '1' });
      const templatesLine = makeLine({ moduleSource: 'templates', moduleItemId: '9' });
      service.registerAdapter(makeMockAdapter('agents', [agentsLine]));
      service.registerAdapter(makeMockAdapter('templates', [templatesLine]));

      const result = await service.getForUser(BigInt(1));
      expect(result).toHaveLength(2);
      expect(result).toEqual(expect.arrayContaining([agentsLine, templatesLine]));
    });

    it('passes userId to each adapter', async () => {
      const adapter = makeMockAdapter('agents');
      service.registerAdapter(adapter);
      await service.getForUser(BigInt(42));
      expect(adapter.getForUser).toHaveBeenCalledWith(BigInt(42));
    });
  });

  describe('removeItem', () => {
    it('delegates to the correct adapter by moduleSource', async () => {
      const agentsAdapter = makeMockAdapter('agents');
      const templatesAdapter = makeMockAdapter('templates');
      service.registerAdapter(agentsAdapter);
      service.registerAdapter(templatesAdapter);

      await service.removeItem(BigInt(1), 'agents', '7');
      expect(agentsAdapter.removeItem).toHaveBeenCalledWith(BigInt(1), '7');
      expect(templatesAdapter.removeItem).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no adapter is registered for the module', async () => {
      await expect(service.removeItem(BigInt(1), 'unknown-module', '7')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('clearForUser', () => {
    it('calls clearForUser on all registered adapters', async () => {
      const a1 = makeMockAdapter('agents');
      const a2 = makeMockAdapter('templates');
      service.registerAdapter(a1);
      service.registerAdapter(a2);

      await service.clearForUser(BigInt(99));
      expect(a1.clearForUser).toHaveBeenCalledWith(BigInt(99));
      expect(a2.clearForUser).toHaveBeenCalledWith(BigInt(99));
    });

    it('no-ops when no adapters are registered', async () => {
      await expect(service.clearForUser(BigInt(1))).resolves.toBeUndefined();
    });
  });
});
