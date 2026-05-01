import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import { ErrorCode } from '../../common/types/response.types';
import { PrismaService } from '../prisma/prisma.service';

export interface WalletRow {
  id: bigint;
  userId: bigint;
  balance: bigint;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  // Ensures every user has exactly one wallet. Safe to call multiple times.
  async findOrCreateForUser(userId: bigint): Promise<WalletRow> {
    return this.prisma.wallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async findByUserId(userId: bigint): Promise<WalletRow> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Wallet not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return wallet;
  }

  async findByUserIdForAdmin(userId: bigint): Promise<WalletRow> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Wallet not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return wallet;
  }
}
