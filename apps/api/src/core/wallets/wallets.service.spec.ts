import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ErrorCode } from '../../common/types/response.types';
import { PrismaService } from '../prisma/prisma.service';

import { WalletsService } from './wallets.service';

describe('WalletsService', () => {
  let service: WalletsService;
  let mockPrisma: { wallet: { upsert: jest.Mock; findUnique: jest.Mock } };

  beforeEach(async () => {
    mockPrisma = {
      wallet: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [WalletsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = moduleRef.get(WalletsService);
  });

  describe('findOrCreateForUser', () => {
    it('uses upsert to ensure idempotency', async () => {
      const wallet = {
        id: 1n,
        userId: 5n,
        balance: 0n,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.wallet.upsert.mockResolvedValue(wallet);

      const result = await service.findOrCreateForUser(5n);

      expect(mockPrisma.wallet.upsert).toHaveBeenCalledWith({
        where: { userId: 5n },
        create: { userId: 5n },
        update: {},
      });
      expect(result).toBe(wallet);
    });

    it('is idempotent — calling twice returns same wallet', async () => {
      const wallet = {
        id: 1n,
        userId: 5n,
        balance: 0n,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.wallet.upsert.mockResolvedValue(wallet);

      const first = await service.findOrCreateForUser(5n);
      const second = await service.findOrCreateForUser(5n);

      expect(first.id).toBe(second.id);
      expect(mockPrisma.wallet.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('findByUserId', () => {
    it('returns the wallet when it exists', async () => {
      const wallet = {
        id: 1n,
        userId: 3n,
        balance: 5000n,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.wallet.findUnique.mockResolvedValue(wallet);

      const result = await service.findByUserId(3n);

      expect(result).toBe(wallet);
      expect(mockPrisma.wallet.findUnique).toHaveBeenCalledWith({ where: { userId: 3n } });
    });

    it('throws NOT_FOUND when wallet does not exist', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(null);

      await expect(service.findByUserId(99n)).rejects.toMatchObject({
        response: { code: ErrorCode.NOT_FOUND },
      });
    });
  });

  describe('findByUserIdForAdmin', () => {
    it('returns wallet without ownership check', async () => {
      const wallet = {
        id: 2n,
        userId: 7n,
        balance: 10000n,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.wallet.findUnique.mockResolvedValue(wallet);

      const result = await service.findByUserIdForAdmin(7n);
      expect(result).toBe(wallet);
    });

    it('throws NOT_FOUND when wallet does not exist', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(null);
      await expect(service.findByUserIdForAdmin(99n)).rejects.toBeInstanceOf(HttpException);
    });
  });
});
