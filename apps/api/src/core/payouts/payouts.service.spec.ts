import { Test } from '@nestjs/testing';
import { PayoutStatus } from '@prisma/client';

import { ErrorCode } from '../../common/types/response.types';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';

import { PayoutsService } from './payouts.service';

const VALID_IBAN = 'IR380570028780010872190001';

function makePayout(
  overrides: Partial<{
    id: bigint;
    userId: bigint;
    walletId: bigint;
    amount: bigint;
    status: PayoutStatus;
    bankAccount: string;
    accountHolder: string;
  }> = {},
) {
  return {
    id: 1n,
    userId: 10n,
    walletId: 5n,
    amount: 100_000n,
    bankAccount: VALID_IBAN,
    accountHolder: 'علی احمدی',
    status: PayoutStatus.PENDING,
    submittedAt: new Date(),
    reviewedByUserId: null,
    reviewedAt: null,
    rejectionReason: null,
    paidAt: null,
    paymentReference: null,
    ...overrides,
  };
}

describe('PayoutsService', () => {
  let service: PayoutsService;
  let mockPrisma: {
    payoutRequest: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    ledgerEntry: { create: jest.Mock };
    wallet: { update: jest.Mock };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };
  let mockWallets: { findByUserId: jest.Mock };
  let notificationsDispatch: jest.Mock;

  const userId = 10n;
  const walletId = 5n;

  beforeEach(async () => {
    mockPrisma = {
      payoutRequest: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ledgerEntry: { create: jest.fn().mockResolvedValue({}) },
      wallet: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (cb: (tx: typeof mockPrisma) => Promise<unknown>) =>
        cb(mockPrisma),
      ),
      $queryRaw: jest.fn().mockResolvedValue([{ id: walletId, userId, balance: 500_000n }]),
    };

    mockWallets = {
      findByUserId: jest.fn().mockResolvedValue({ id: walletId, userId, balance: 500_000n }),
    };

    notificationsDispatch = jest.fn().mockResolvedValue({ dispatched: ['IN_APP'], failures: [] });

    const moduleRef = await Test.createTestingModule({
      providers: [
        PayoutsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: {} },
        { provide: WalletsService, useValue: mockWallets },
        { provide: NotificationsService, useValue: { dispatch: notificationsDispatch } },
      ],
    }).compile();

    service = moduleRef.get(PayoutsService);
  });

  // ──────── request ────────

  describe('request', () => {
    it('creates payout row, debits wallet, and dispatches notification', async () => {
      const payout = makePayout();
      mockPrisma.payoutRequest.create.mockResolvedValue(payout);

      const result = await service.request({
        userId,
        amount: 100_000n,
        bankAccount: VALID_IBAN,
        accountHolder: 'علی احمدی',
      });

      expect(mockPrisma.payoutRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
            amount: 100_000n,
            bankAccount: VALID_IBAN,
            status: PayoutStatus.PENDING,
          }),
        }),
      );
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kind: 'DEBIT', amount: 100_000n }),
        }),
      );
      expect(mockPrisma.wallet.update).toHaveBeenCalledWith({
        where: { id: walletId },
        data: { balance: 400_000n },
      });
      expect(notificationsDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ userId, type: 'PAYOUT_REQUESTED' }),
      );
      expect(result).toEqual(payout);
    });

    it('rejects an invalid IBAN', async () => {
      await expect(
        service.request({
          userId,
          amount: 100_000n,
          bankAccount: 'INVALID',
          accountHolder: 'Test',
        }),
      ).rejects.toMatchObject({ response: { code: ErrorCode.INVALID_IBAN } });
      expect(mockPrisma.payoutRequest.create).not.toHaveBeenCalled();
    });

    it('rejects zero amount', async () => {
      await expect(
        service.request({ userId, amount: 0n, bankAccount: VALID_IBAN, accountHolder: 'Test' }),
      ).rejects.toMatchObject({ response: { code: ErrorCode.VALIDATION_ERROR } });
    });

    it('throws INSUFFICIENT_FUNDS when wallet balance is too low', async () => {
      // Override wallet mock to return low balance
      mockPrisma.$queryRaw.mockResolvedValue([{ id: walletId, userId, balance: 50_000n }]);

      await expect(
        service.request({
          userId,
          amount: 100_000n,
          bankAccount: VALID_IBAN,
          accountHolder: 'Test',
        }),
      ).rejects.toMatchObject({ response: { code: ErrorCode.INSUFFICIENT_FUNDS } });

      expect(mockPrisma.ledgerEntry.create).not.toHaveBeenCalled();
    });
  });

  // ──────── approve ────────

  describe('approve', () => {
    it('transitions PENDING → APPROVED and dispatches notification', async () => {
      const payout = makePayout();
      mockPrisma.payoutRequest.findUnique.mockResolvedValue(payout);
      mockPrisma.payoutRequest.update.mockResolvedValue({
        ...payout,
        status: PayoutStatus.APPROVED,
      });

      const result = await service.approve(1n, 99n);

      expect(mockPrisma.payoutRequest.update).toHaveBeenCalledWith({
        where: { id: 1n },
        data: expect.objectContaining({
          status: PayoutStatus.APPROVED,
          reviewedByUserId: 99n,
        }),
      });
      expect(notificationsDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ userId, type: 'PAYOUT_APPROVED' }),
      );
      expect(result.status).toBe(PayoutStatus.APPROVED);
    });

    it('throws PAYOUT_NOT_PENDING when already approved', async () => {
      mockPrisma.payoutRequest.findUnique.mockResolvedValue(
        makePayout({ status: PayoutStatus.APPROVED }),
      );
      await expect(service.approve(1n, 99n)).rejects.toMatchObject({
        response: { code: ErrorCode.PAYOUT_NOT_PENDING },
      });
    });

    it('throws NOT_FOUND for non-existent payout', async () => {
      mockPrisma.payoutRequest.findUnique.mockResolvedValue(null);
      await expect(service.approve(99n, 1n)).rejects.toMatchObject({
        response: { code: ErrorCode.NOT_FOUND },
      });
    });
  });

  // ──────── reject ────────

  describe('reject', () => {
    it('transitions PENDING → REJECTED, credits wallet back, dispatches notification', async () => {
      const payout = makePayout();
      mockPrisma.payoutRequest.findUnique.mockResolvedValue(payout);
      mockPrisma.payoutRequest.update.mockResolvedValue({
        ...payout,
        status: PayoutStatus.REJECTED,
        rejectionReason: 'مدارک ناقص',
      });

      await service.reject(1n, 99n, 'مدارک ناقص');

      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kind: 'CREDIT', amount: 100_000n }),
        }),
      );
      expect(notificationsDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          type: 'PAYOUT_REJECTED',
          payload: expect.objectContaining({ reason: 'مدارک ناقص' }),
        }),
      );
    });

    it('throws PAYOUT_NOT_PENDING when already rejected', async () => {
      mockPrisma.payoutRequest.findUnique.mockResolvedValue(
        makePayout({ status: PayoutStatus.REJECTED }),
      );
      await expect(service.reject(1n, 99n, 'reason')).rejects.toMatchObject({
        response: { code: ErrorCode.PAYOUT_NOT_PENDING },
      });
    });
  });

  // ──────── markPaid ────────

  describe('markPaid', () => {
    it('transitions APPROVED → PAID and dispatches notification', async () => {
      const payout = makePayout({ status: PayoutStatus.APPROVED });
      mockPrisma.payoutRequest.findUnique.mockResolvedValue(payout);
      mockPrisma.payoutRequest.update.mockResolvedValue({ ...payout, status: PayoutStatus.PAID });

      await service.markPaid(1n, 99n, 'REF-12345');

      expect(mockPrisma.payoutRequest.update).toHaveBeenCalledWith({
        where: { id: 1n },
        data: expect.objectContaining({
          status: PayoutStatus.PAID,
          paymentReference: 'REF-12345',
        }),
      });
      expect(notificationsDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PAYOUT_PAID',
          payload: expect.objectContaining({ paymentReference: 'REF-12345' }),
        }),
      );
    });

    it('throws PAYOUT_NOT_APPROVED when status is PENDING', async () => {
      mockPrisma.payoutRequest.findUnique.mockResolvedValue(makePayout());
      await expect(service.markPaid(1n, 99n, 'REF')).rejects.toMatchObject({
        response: { code: ErrorCode.PAYOUT_NOT_APPROVED },
      });
    });
  });

  // ──────── cancel ────────

  describe('cancel', () => {
    it('transitions PENDING → CANCELLED and credits wallet back (no notification)', async () => {
      const payout = makePayout();
      mockPrisma.payoutRequest.findUnique.mockResolvedValue(payout);
      mockPrisma.payoutRequest.update.mockResolvedValue({
        ...payout,
        status: PayoutStatus.CANCELLED,
      });

      await service.cancel(1n, userId);

      expect(mockPrisma.payoutRequest.update).toHaveBeenCalledWith({
        where: { id: 1n },
        data: { status: PayoutStatus.CANCELLED },
      });
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ kind: 'CREDIT', amount: 100_000n }),
        }),
      );
      expect(notificationsDispatch).not.toHaveBeenCalled();
    });

    it('throws NOT_FOUND when userId does not match', async () => {
      mockPrisma.payoutRequest.findUnique.mockResolvedValue(makePayout({ userId: 99n }));
      await expect(service.cancel(1n, userId)).rejects.toMatchObject({
        response: { code: ErrorCode.NOT_FOUND },
      });
    });

    it('throws PAYOUT_NOT_PENDING when already approved', async () => {
      mockPrisma.payoutRequest.findUnique.mockResolvedValue(
        makePayout({ status: PayoutStatus.APPROVED }),
      );
      await expect(service.cancel(1n, userId)).rejects.toMatchObject({
        response: { code: ErrorCode.PAYOUT_NOT_PENDING },
      });
    });
  });
});
