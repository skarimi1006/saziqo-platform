import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { LedgerKind, Prisma } from '@prisma/client';

import { ErrorCode } from '../../common/types/response.types';
import { PrismaService } from '../prisma/prisma.service';

export interface LedgerWriteInput {
  walletId: bigint;
  amount: bigint;
  reference?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface TransferInput {
  fromWalletId: bigint;
  toWalletId: bigint;
  amount: bigint;
  reference?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface LedgerEntryRow {
  id: bigint;
  walletId: bigint | null;
  userId: bigint | null;
  kind: LedgerKind;
  amount: bigint;
  currency: string;
  reference: string | null;
  description: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface LedgerPage {
  items: LedgerEntryRow[];
  nextCursor: bigint | null;
  hasMore: boolean;
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async credit(input: LedgerWriteInput): Promise<LedgerEntryRow> {
    this.assertPositive(input.amount);
    return this.prisma.$transaction(async (tx) => {
      const wallet = await this.lockWallet(tx, input.walletId);
      const newBalance = wallet.balance + input.amount;

      const entry = await tx.ledgerEntry.create({
        data: {
          walletId: input.walletId,
          userId: wallet.userId,
          kind: LedgerKind.CREDIT,
          amount: input.amount,
          reference: input.reference ?? null,
          description: input.description ?? null,
          metadata:
            input.metadata !== undefined
              ? (input.metadata as Prisma.InputJsonValue)
              : Prisma.DbNull,
        },
      });

      await tx.wallet.update({
        where: { id: input.walletId },
        data: { balance: newBalance },
      });

      return entry;
    });
  }

  async debit(input: LedgerWriteInput): Promise<LedgerEntryRow> {
    this.assertPositive(input.amount);
    return this.prisma.$transaction(async (tx) => {
      const wallet = await this.lockWallet(tx, input.walletId);
      const newBalance = wallet.balance - input.amount;

      if (newBalance < 0n) {
        throw new HttpException(
          { code: ErrorCode.INSUFFICIENT_FUNDS, message: 'Insufficient wallet balance' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const entry = await tx.ledgerEntry.create({
        data: {
          walletId: input.walletId,
          userId: wallet.userId,
          kind: LedgerKind.DEBIT,
          amount: input.amount,
          reference: input.reference ?? null,
          description: input.description ?? null,
          metadata:
            input.metadata !== undefined
              ? (input.metadata as Prisma.InputJsonValue)
              : Prisma.DbNull,
        },
      });

      await tx.wallet.update({
        where: { id: input.walletId },
        data: { balance: newBalance },
      });

      return entry;
    });
  }

  // Both wallets are locked in ascending id order to prevent deadlocks.
  // Cross-reference is encoded via the shared reference string on both entries.
  async transfer(
    input: TransferInput,
  ): Promise<{ debitEntry: LedgerEntryRow; creditEntry: LedgerEntryRow }> {
    this.assertPositive(input.amount);
    if (input.fromWalletId === input.toWalletId) {
      throw new HttpException(
        { code: ErrorCode.VALIDATION_ERROR, message: 'Cannot transfer to the same wallet' },
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Lock in deterministic order (lowest id first) to prevent deadlocks
      const [firstId, secondId] =
        input.fromWalletId < input.toWalletId
          ? [input.fromWalletId, input.toWalletId]
          : [input.toWalletId, input.fromWalletId];

      const firstLocked = await this.lockWallet(tx, firstId);
      const secondLocked = await this.lockWallet(tx, secondId);

      // Identify which locked row is from/to
      const fromWallet = firstLocked.id === input.fromWalletId ? firstLocked : secondLocked;
      const toWallet = firstLocked.id === input.toWalletId ? firstLocked : secondLocked;

      const newFromBalance = fromWallet.balance - input.amount;
      if (newFromBalance < 0n) {
        throw new HttpException(
          {
            code: ErrorCode.INSUFFICIENT_FUNDS,
            message: 'Insufficient wallet balance for transfer',
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const transferMeta = {
        ...(input.metadata ?? {}),
        fromWalletId: input.fromWalletId.toString(),
        toWalletId: input.toWalletId.toString(),
      };

      const debitEntry = await tx.ledgerEntry.create({
        data: {
          walletId: input.fromWalletId,
          userId: fromWallet.userId,
          kind: LedgerKind.DEBIT,
          amount: input.amount,
          reference: input.reference ?? null,
          description: input.description ?? null,
          metadata: transferMeta as Prisma.InputJsonValue,
        },
      });

      await tx.wallet.update({
        where: { id: input.fromWalletId },
        data: { balance: newFromBalance },
      });

      const creditEntry = await tx.ledgerEntry.create({
        data: {
          walletId: input.toWalletId,
          userId: toWallet.userId,
          kind: LedgerKind.CREDIT,
          amount: input.amount,
          reference: input.reference ?? null,
          description: input.description ?? null,
          metadata: transferMeta as Prisma.InputJsonValue,
        },
      });

      await tx.wallet.update({
        where: { id: input.toWalletId },
        data: { balance: toWallet.balance + input.amount },
      });

      return { debitEntry, creditEntry };
    });
  }

  async getBalance(walletId: bigint): Promise<bigint> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
      select: { balance: true },
    });
    if (!wallet) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Wallet not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return wallet.balance;
  }

  async verifyBalance(walletId: bigint): Promise<void> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
      select: { balance: true },
    });
    if (!wallet) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Wallet not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    const rows = await this.prisma.$queryRaw<[{ computed: bigint }]>`
      SELECT COALESCE(
        SUM(CASE WHEN kind = 'CREDIT' THEN amount ELSE -amount END), 0
      )::BIGINT AS computed
      FROM ledger_entries
      WHERE "walletId" = ${walletId}
    `;

    const computed = rows[0]?.computed ?? 0n;
    if (computed !== wallet.balance) {
      throw new HttpException(
        {
          code: ErrorCode.BALANCE_MISMATCH,
          message: `Balance mismatch: stored=${wallet.balance.toString()}, computed=${computed.toString()}`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findEntriesForWallet(
    walletId: bigint,
    pagination: { cursor?: bigint; limit: number },
  ): Promise<LedgerPage> {
    const take = pagination.limit + 1;
    const where = {
      walletId,
      ...(pagination.cursor !== undefined && { id: { lt: pagination.cursor } }),
    };

    const rows = await this.prisma.ledgerEntry.findMany({
      where,
      orderBy: { id: 'desc' },
      take,
    });

    const hasMore = rows.length > pagination.limit;
    const items = hasMore ? rows.slice(0, pagination.limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? last.id : null;

    return { items, nextCursor, hasMore };
  }

  // ──────── private helpers ────────

  private assertPositive(amount: bigint): void {
    if (amount <= 0n) {
      throw new HttpException(
        { code: ErrorCode.VALIDATION_ERROR, message: 'Amount must be positive' },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // Issues a SELECT ... FOR UPDATE within an active transaction to serialize
  // concurrent writes on the same wallet row.
  private async lockWallet(
    tx: Prisma.TransactionClient,
    walletId: bigint,
  ): Promise<{ id: bigint; userId: bigint; balance: bigint }> {
    const rows = await tx.$queryRaw<[{ id: bigint; userId: bigint; balance: bigint }]>`
      SELECT id, "userId", balance FROM wallets WHERE id = ${walletId} FOR UPDATE
    `;
    const row = rows[0];
    if (!row) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Wallet not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return row;
  }
}
