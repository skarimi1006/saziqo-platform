import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PayoutRequest, PayoutStatus, Prisma } from '@prisma/client';
import { isValidIranianIban } from '@saziqo/persian-utils';

import { ErrorCode } from '../../common/types/response.types';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/types.catalog';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';

export interface RequestPayoutInput {
  userId: bigint;
  amount: bigint;
  bankAccount: string;
  accountHolder: string;
}

export interface PayoutPage {
  items: PayoutRequest[];
  nextCursor: bigint | null;
  hasMore: boolean;
}

@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletsService,
    private readonly notifications: NotificationsService,
  ) {}

  async request(input: RequestPayoutInput): Promise<PayoutRequest> {
    if (!isValidIranianIban(input.bankAccount)) {
      throw new HttpException(
        { code: ErrorCode.INVALID_IBAN, message: 'Invalid Iranian IBAN (شبا)' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (input.amount <= 0n) {
      throw new HttpException(
        { code: ErrorCode.VALIDATION_ERROR, message: 'Payout amount must be positive' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const wallet = await this.wallets.findByUserId(input.userId);

    // Use a transaction to atomically debit the wallet and create the payout row
    const payout = await this.prisma.$transaction(async (tx) => {
      const payoutRow = await tx.payoutRequest.create({
        data: {
          userId: input.userId,
          walletId: wallet.id,
          amount: input.amount,
          bankAccount: input.bankAccount,
          accountHolder: input.accountHolder,
          status: PayoutStatus.PENDING,
        },
      });

      // Debit wallet via raw Prisma (bypass LedgerService to stay in transaction)
      const rows = await tx.$queryRaw<[{ id: bigint; userId: bigint; balance: bigint }]>`
        SELECT id, "userId", balance FROM wallets WHERE id = ${wallet.id} FOR UPDATE
      `;
      const walletRow = rows[0];
      if (!walletRow)
        throw new HttpException(
          { code: ErrorCode.NOT_FOUND, message: 'Wallet not found' },
          HttpStatus.NOT_FOUND,
        );

      const newBalance = walletRow.balance - input.amount;
      if (newBalance < 0n) {
        throw new HttpException(
          { code: ErrorCode.INSUFFICIENT_FUNDS, message: 'Insufficient wallet balance for payout' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          userId: input.userId,
          kind: 'DEBIT',
          amount: input.amount,
          reference: `payout:${payoutRow.id.toString()}`,
          description: 'Payout pending review',
          metadata: { payoutRequestId: payoutRow.id.toString() } as Prisma.InputJsonValue,
        },
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance },
      });

      return payoutRow;
    });

    await this.notifications.dispatch({
      userId: input.userId,
      type: NOTIFICATION_TYPES.PAYOUT_REQUESTED,
      payload: { amount: input.amount },
      channels: ['IN_APP'],
    });

    return payout;
  }

  async approve(payoutId: bigint, reviewerUserId: bigint): Promise<PayoutRequest> {
    const existing = await this.findOrThrow(payoutId);

    if (existing.status !== PayoutStatus.PENDING) {
      throw new HttpException(
        { code: ErrorCode.PAYOUT_NOT_PENDING, message: 'Payout is not in PENDING status' },
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.payoutRequest.update({
      where: { id: payoutId },
      data: {
        status: PayoutStatus.APPROVED,
        reviewedByUserId: reviewerUserId,
        reviewedAt: new Date(),
      },
    });

    await this.notifications.dispatch({
      userId: existing.userId,
      type: NOTIFICATION_TYPES.PAYOUT_APPROVED,
      payload: { amount: existing.amount },
      channels: ['IN_APP'],
    });

    return updated;
  }

  async reject(payoutId: bigint, reviewerUserId: bigint, reason: string): Promise<PayoutRequest> {
    const existing = await this.findOrThrow(payoutId);

    if (existing.status !== PayoutStatus.PENDING) {
      throw new HttpException(
        { code: ErrorCode.PAYOUT_NOT_PENDING, message: 'Payout is not in PENDING status' },
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.payoutRequest.update({
        where: { id: payoutId },
        data: {
          status: PayoutStatus.REJECTED,
          reviewedByUserId: reviewerUserId,
          reviewedAt: new Date(),
          rejectionReason: reason,
        },
      });

      // Credit wallet back — hold released
      const rows = await tx.$queryRaw<[{ id: bigint; userId: bigint; balance: bigint }]>`
        SELECT id, "userId", balance FROM wallets WHERE id = ${existing.walletId} FOR UPDATE
      `;
      const walletRow = rows[0];
      if (!walletRow)
        throw new HttpException(
          { code: ErrorCode.NOT_FOUND, message: 'Wallet not found' },
          HttpStatus.NOT_FOUND,
        );

      await tx.ledgerEntry.create({
        data: {
          walletId: existing.walletId,
          userId: existing.userId,
          kind: 'CREDIT',
          amount: existing.amount,
          reference: `payout:rejected:${payoutId.toString()}`,
          description: 'Payout rejected — refund',
          metadata: { payoutRequestId: payoutId.toString() } as Prisma.InputJsonValue,
        },
      });

      await tx.wallet.update({
        where: { id: existing.walletId },
        data: { balance: walletRow.balance + existing.amount },
      });

      return row;
    });

    await this.notifications.dispatch({
      userId: existing.userId,
      type: NOTIFICATION_TYPES.PAYOUT_REJECTED,
      payload: { amount: existing.amount, reason },
      channels: ['IN_APP'],
    });

    return updated;
  }

  async markPaid(
    payoutId: bigint,
    reviewerUserId: bigint,
    paymentReference: string,
  ): Promise<PayoutRequest> {
    const existing = await this.findOrThrow(payoutId);

    if (existing.status !== PayoutStatus.APPROVED) {
      throw new HttpException(
        { code: ErrorCode.PAYOUT_NOT_APPROVED, message: 'Payout is not in APPROVED status' },
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.payoutRequest.update({
      where: { id: payoutId },
      data: {
        status: PayoutStatus.PAID,
        paidAt: new Date(),
        paymentReference,
        reviewedByUserId: reviewerUserId,
      },
    });

    await this.notifications.dispatch({
      userId: existing.userId,
      type: NOTIFICATION_TYPES.PAYOUT_PAID,
      payload: { amount: existing.amount, paymentReference },
      channels: ['IN_APP'],
    });

    return updated;
  }

  async cancel(payoutId: bigint, userId: bigint): Promise<PayoutRequest> {
    const existing = await this.findOrThrow(payoutId);

    if (existing.userId !== userId) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Payout not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    if (existing.status !== PayoutStatus.PENDING) {
      throw new HttpException(
        { code: ErrorCode.PAYOUT_NOT_PENDING, message: 'Only PENDING payouts can be cancelled' },
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.payoutRequest.update({
        where: { id: payoutId },
        data: { status: PayoutStatus.CANCELLED },
      });

      const rows = await tx.$queryRaw<[{ id: bigint; userId: bigint; balance: bigint }]>`
        SELECT id, "userId", balance FROM wallets WHERE id = ${existing.walletId} FOR UPDATE
      `;
      const walletRow = rows[0];
      if (!walletRow)
        throw new HttpException(
          { code: ErrorCode.NOT_FOUND, message: 'Wallet not found' },
          HttpStatus.NOT_FOUND,
        );

      await tx.ledgerEntry.create({
        data: {
          walletId: existing.walletId,
          userId: existing.userId,
          kind: 'CREDIT',
          amount: existing.amount,
          reference: `payout:cancelled:${payoutId.toString()}`,
          description: 'Payout cancelled — refund',
          metadata: { payoutRequestId: payoutId.toString() } as Prisma.InputJsonValue,
        },
      });

      await tx.wallet.update({
        where: { id: existing.walletId },
        data: { balance: walletRow.balance + existing.amount },
      });

      return row;
    });

    return updated;
  }

  async findForUser(
    userId: bigint,
    pagination: { cursor?: bigint; limit: number },
  ): Promise<PayoutPage> {
    const take = pagination.limit + 1;
    const where = {
      userId,
      ...(pagination.cursor !== undefined && { id: { lt: pagination.cursor } }),
    };

    const rows = await this.prisma.payoutRequest.findMany({
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

  async findForAdmin(filters: {
    status?: PayoutStatus;
    userId?: bigint;
    cursor?: bigint;
    limit: number;
  }): Promise<PayoutPage> {
    const take = filters.limit + 1;
    const where: Prisma.PayoutRequestWhereInput = {
      ...(filters.status !== undefined && { status: filters.status }),
      ...(filters.userId !== undefined && { userId: filters.userId }),
      ...(filters.cursor !== undefined && { id: { lt: filters.cursor } }),
    };

    const rows = await this.prisma.payoutRequest.findMany({
      where,
      orderBy: { id: 'desc' },
      take,
    });

    const hasMore = rows.length > filters.limit;
    const items = hasMore ? rows.slice(0, filters.limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? last.id : null;

    return { items, nextCursor, hasMore };
  }

  // ──────── private helpers ────────

  private async findOrThrow(payoutId: bigint): Promise<PayoutRequest> {
    const row = await this.prisma.payoutRequest.findUnique({ where: { id: payoutId } });
    if (!row) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Payout request not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return row;
  }
}
