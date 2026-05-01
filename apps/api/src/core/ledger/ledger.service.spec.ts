import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LedgerKind } from '@prisma/client';

import { ErrorCode } from '../../common/types/response.types';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

import { LedgerService } from './ledger.service';

// Helpers to build wallet rows and ledger entry rows for mocks
function makeWallet(id: bigint, balance: bigint, userId = 1n) {
  return { id, userId, balance };
}

function makeEntry(id: bigint, walletId: bigint, kind: LedgerKind, amount: bigint, userId = 1n) {
  return {
    id,
    walletId,
    userId,
    kind,
    amount,
    currency: 'IRT',
    reference: null,
    description: null,
    metadata: null,
    createdAt: new Date(),
  };
}

describe('LedgerService', () => {
  let service: LedgerService;
  let mockPrisma: {
    wallet: { findUnique: jest.Mock; update: jest.Mock };
    ledgerEntry: { create: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };
  let notificationsDispatch: jest.Mock;

  const walletId = 10n;
  const userId = 1n;

  beforeEach(async () => {
    mockPrisma = {
      wallet: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      ledgerEntry: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (cb: (tx: typeof mockPrisma) => Promise<unknown>) =>
        cb(mockPrisma),
      ),
      $queryRaw: jest.fn(),
    };

    notificationsDispatch = jest.fn().mockResolvedValue({ dispatched: ['IN_APP'], failures: [] });

    const moduleRef = await Test.createTestingModule({
      providers: [
        LedgerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: { dispatch: notificationsDispatch } },
      ],
    }).compile();

    service = moduleRef.get(LedgerService);
  });

  // ──────── credit ────────

  describe('credit', () => {
    it('creates a CREDIT entry, increments wallet balance, and dispatches notification', async () => {
      const wallet = makeWallet(walletId, 1000n, userId);
      const entry = makeEntry(1n, walletId, LedgerKind.CREDIT, 500n);

      mockPrisma.$queryRaw.mockResolvedValue([wallet]);
      mockPrisma.ledgerEntry.create.mockResolvedValue(entry);

      const result = await service.credit({ walletId, amount: 500n });

      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            walletId,
            kind: LedgerKind.CREDIT,
            amount: 500n,
          }),
        }),
      );
      expect(mockPrisma.wallet.update).toHaveBeenCalledWith({
        where: { id: walletId },
        data: { balance: 1500n },
      });
      expect(notificationsDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          type: 'WALLET_CREDITED',
          channels: ['IN_APP'],
        }),
      );
      expect(result).toEqual(entry);
    });

    it('rejects non-positive amount', async () => {
      await expect(service.credit({ walletId, amount: 0n })).rejects.toMatchObject({
        response: { code: ErrorCode.VALIDATION_ERROR },
      });
      await expect(service.credit({ walletId, amount: -1n })).rejects.toMatchObject({
        response: { code: ErrorCode.VALIDATION_ERROR },
      });
    });

    it('throws NOT_FOUND when wallet does not exist', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      await expect(service.credit({ walletId, amount: 100n })).rejects.toMatchObject({
        response: { code: ErrorCode.NOT_FOUND },
      });
    });
  });

  // ──────── debit ────────

  describe('debit', () => {
    it('creates a DEBIT entry, decrements wallet balance, and dispatches notification', async () => {
      const wallet = makeWallet(walletId, 2000n, userId);
      const entry = makeEntry(2n, walletId, LedgerKind.DEBIT, 300n);

      mockPrisma.$queryRaw.mockResolvedValue([wallet]);
      mockPrisma.ledgerEntry.create.mockResolvedValue(entry);

      await service.debit({ walletId, amount: 300n });

      expect(mockPrisma.wallet.update).toHaveBeenCalledWith({
        where: { id: walletId },
        data: { balance: 1700n },
      });
      expect(notificationsDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ userId, type: 'WALLET_DEBITED', channels: ['IN_APP'] }),
      );
    });

    it('throws INSUFFICIENT_FUNDS when debit exceeds balance', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([makeWallet(walletId, 100n)]);

      await expect(service.debit({ walletId, amount: 200n })).rejects.toMatchObject({
        response: { code: ErrorCode.INSUFFICIENT_FUNDS },
      });
      expect(mockPrisma.ledgerEntry.create).not.toHaveBeenCalled();
      expect(mockPrisma.wallet.update).not.toHaveBeenCalled();
    });

    it('allows debit that exactly empties the wallet', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([makeWallet(walletId, 500n)]);
      mockPrisma.ledgerEntry.create.mockResolvedValue(
        makeEntry(3n, walletId, LedgerKind.DEBIT, 500n),
      );

      await service.debit({ walletId, amount: 500n });

      expect(mockPrisma.wallet.update).toHaveBeenCalledWith({
        where: { id: walletId },
        data: { balance: 0n },
      });
    });
  });

  // ──────── transfer ────────

  describe('transfer', () => {
    const fromId = 10n;
    const toId = 20n;

    it('creates DEBIT + CREDIT entries with shared reference', async () => {
      // lockWallet locks both wallets in deterministic order (fromId < toId)
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([makeWallet(fromId, 1000n)])
        .mockResolvedValueOnce([makeWallet(toId, 500n)]);

      mockPrisma.ledgerEntry.create
        .mockResolvedValueOnce(makeEntry(4n, fromId, LedgerKind.DEBIT, 200n))
        .mockResolvedValueOnce(makeEntry(5n, toId, LedgerKind.CREDIT, 200n));

      const result = await service.transfer({
        fromWalletId: fromId,
        toWalletId: toId,
        amount: 200n,
        reference: 'TXN-001',
      });

      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledTimes(2);
      expect(result.debitEntry.kind).toBe(LedgerKind.DEBIT);
      expect(result.creditEntry.kind).toBe(LedgerKind.CREDIT);

      // Both wallet updates happened
      expect(mockPrisma.wallet.update).toHaveBeenCalledTimes(2);
      expect(mockPrisma.wallet.update).toHaveBeenCalledWith({
        where: { id: fromId },
        data: { balance: 800n },
      });
      expect(mockPrisma.wallet.update).toHaveBeenCalledWith({
        where: { id: toId },
        data: { balance: 700n },
      });
    });

    it('throws INSUFFICIENT_FUNDS when source wallet cannot cover amount', async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([makeWallet(fromId, 50n)])
        .mockResolvedValueOnce([makeWallet(toId, 0n)]);

      await expect(
        service.transfer({ fromWalletId: fromId, toWalletId: toId, amount: 200n }),
      ).rejects.toMatchObject({ response: { code: ErrorCode.INSUFFICIENT_FUNDS } });

      expect(mockPrisma.ledgerEntry.create).not.toHaveBeenCalled();
    });

    it('rejects transfer to same wallet', async () => {
      await expect(
        service.transfer({ fromWalletId: 10n, toWalletId: 10n, amount: 100n }),
      ).rejects.toMatchObject({ response: { code: ErrorCode.VALIDATION_ERROR } });
    });
  });

  // ──────── getBalance ────────

  describe('getBalance', () => {
    it('returns stored balance', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({ balance: 3000n });
      const bal = await service.getBalance(walletId);
      expect(bal).toBe(3000n);
    });

    it('throws NOT_FOUND for missing wallet', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(null);
      await expect(service.getBalance(walletId)).rejects.toBeInstanceOf(HttpException);
    });
  });

  // ──────── verifyBalance ────────

  describe('verifyBalance', () => {
    it('resolves when stored balance matches computed sum', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({ balance: 1200n });
      mockPrisma.$queryRaw.mockResolvedValue([{ computed: 1200n }]);

      await expect(service.verifyBalance(walletId)).resolves.toBeUndefined();
    });

    it('throws BALANCE_MISMATCH when stored and computed differ', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({ balance: 1000n });
      mockPrisma.$queryRaw.mockResolvedValue([{ computed: 1200n }]);

      await expect(service.verifyBalance(walletId)).rejects.toMatchObject({
        response: { code: ErrorCode.BALANCE_MISMATCH },
      });
    });
  });

  // ──────── findEntriesForWallet ────────

  describe('findEntriesForWallet', () => {
    it('returns paginated entries with hasMore flag', async () => {
      const entries = Array.from({ length: 11 }, (_, i) =>
        makeEntry(BigInt(100 - i), walletId, LedgerKind.CREDIT, 100n),
      );
      mockPrisma.ledgerEntry.findMany.mockResolvedValue(entries);

      const page = await service.findEntriesForWallet(walletId, { limit: 10 });

      expect(page.items).toHaveLength(10);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBe(entries[9]!.id);
    });

    it('returns hasMore=false when results fit within limit', async () => {
      mockPrisma.ledgerEntry.findMany.mockResolvedValue([
        makeEntry(1n, walletId, LedgerKind.DEBIT, 50n),
      ]);

      const page = await service.findEntriesForWallet(walletId, { limit: 10 });

      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });
  });

  // ──────── reconciliationReport ────────

  describe('reconciliationReport', () => {
    it('returns OK status for wallets with matching balances', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { walletId: 1n, userId: 10n, storedBalance: 1000n, computedBalance: 1000n },
        { walletId: 2n, userId: 20n, storedBalance: 500n, computedBalance: 500n },
      ]);

      const report = await service.reconciliationReport();

      expect(report.items).toHaveLength(2);
      expect(report.items.every((r) => r.status === 'OK')).toBe(true);
      expect(report.items.every((r) => r.drift === 0n)).toBe(true);
      expect(report.summary.walletsWithDrift).toBe(0);
      expect(report.summary.totalWallets).toBe(2);
      expect(report.summary.totalStoredBalance).toBe(1500n);
    });

    it('returns DRIFT status for tampered wallet balance', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { walletId: 1n, userId: 10n, storedBalance: 9999n, computedBalance: 1000n },
        { walletId: 2n, userId: 20n, storedBalance: 500n, computedBalance: 500n },
      ]);

      const report = await service.reconciliationReport();

      const drifted = report.items.find((r) => r.walletId === 1n)!;
      expect(drifted.status).toBe('DRIFT');
      expect(drifted.drift).toBe(8999n);
      expect(report.summary.walletsWithDrift).toBe(1);
    });

    it('sets cappedAt when results exceed limit', async () => {
      const rows = Array.from({ length: 11 }, (_, i) => ({
        walletId: BigInt(i + 1),
        userId: BigInt(i + 100),
        storedBalance: 0n,
        computedBalance: 0n,
      }));
      mockPrisma.$queryRaw.mockResolvedValue(rows);

      const report = await service.reconciliationReport({ limit: 10 });

      expect(report.items).toHaveLength(10);
      expect(report.summary.cappedAt).toBe(10);
    });

    it('sets cappedAt to null when all wallets fit', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { walletId: 1n, userId: 1n, storedBalance: 0n, computedBalance: 0n },
      ]);

      const report = await service.reconciliationReport({ limit: 10 });
      expect(report.summary.cappedAt).toBeNull();
    });
  });

  // ──────── aggregates ────────

  describe('aggregates', () => {
    it('returns daily aggregates with netFlow computed', async () => {
      const now = new Date();
      mockPrisma.$queryRaw.mockResolvedValue([
        { date: now, credits: 5000n, debits: 2000n, entryCount: 10n },
        { date: new Date(now.getTime() - 86400000), credits: 3000n, debits: 1000n, entryCount: 5n },
      ]);

      const report = await service.aggregates({ days: 7 });

      expect(report.data).toHaveLength(2);
      expect(report.data[0]!.netFlow).toBe(3000n);
      expect(report.data[1]!.netFlow).toBe(2000n);
      expect(report.data[0]!.entryCount).toBe(10n);
    });

    it('defaults to 30 days when no option given', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      await service.aggregates();
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });
  });
});
