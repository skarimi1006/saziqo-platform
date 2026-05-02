import { Logger } from '@nestjs/common';
import { LedgerKind, PaymentStatus } from '@prisma/client';

import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';

import { PaymentLedgerReconciler } from './payment-ledger.reconciler';

interface ReconcilerHarness {
  reconciler: PaymentLedgerReconciler;
  prisma: PrismaService;
  wallets: WalletsService;
  ledger: LedgerService;
  paymentFindUnique: jest.Mock;
  ledgerFindFirst: jest.Mock;
  walletsFindOrCreate: jest.Mock;
  ledgerCredit: jest.Mock;
}

function buildPayment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7n,
    userId: 42n,
    amount: 50_000n,
    purpose: 'wallet_topup',
    description: 'Top up',
    status: PaymentStatus.SUCCEEDED,
    providerName: 'console',
    providerReference: 'auth-7',
    referenceCode: 'BANK-9',
    cardPanMasked: null,
    metadata: {},
    initiatedAt: new Date(),
    completedAt: new Date(),
    failureReason: null,
    ...overrides,
  };
}

function build(opts: {
  payment: Record<string, unknown> | null;
  existingLedgerEntry?: { id: bigint } | null;
}): ReconcilerHarness {
  const paymentFindUnique = jest.fn().mockResolvedValue(opts.payment);
  const ledgerFindFirst = jest.fn().mockResolvedValue(opts.existingLedgerEntry ?? null);
  const prisma = {
    payment: { findUnique: paymentFindUnique },
    ledgerEntry: { findFirst: ledgerFindFirst },
  } as unknown as PrismaService;

  const walletsFindOrCreate = jest.fn().mockResolvedValue({
    id: 99n,
    userId: 42n,
    balance: 0n,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const wallets = { findOrCreateForUser: walletsFindOrCreate } as unknown as WalletsService;

  const ledgerCredit = jest.fn().mockResolvedValue({
    id: 1234n,
    walletId: 99n,
    userId: 42n,
    kind: LedgerKind.CREDIT,
    amount: 50_000n,
    currency: 'IRT',
    reference: 'payment:7',
    description: 'Wallet topup — payment #7',
    metadata: { paymentId: '7' },
    createdAt: new Date(),
  });
  const ledger = { credit: ledgerCredit } as unknown as LedgerService;

  return {
    reconciler: new PaymentLedgerReconciler(prisma, wallets, ledger),
    prisma,
    wallets,
    ledger,
    paymentFindUnique,
    ledgerFindFirst,
    walletsFindOrCreate,
    ledgerCredit,
  };
}

describe('PaymentLedgerReconciler', () => {
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
    debugSpy.mockRestore();
  });

  describe('wallet_topup purpose', () => {
    it('creates a credit entry tagged payment:<id> with the exact payment amount', async () => {
      const harness = build({ payment: buildPayment() });

      await harness.reconciler.reconcile(7n);

      expect(harness.walletsFindOrCreate).toHaveBeenCalledWith(42n);
      expect(harness.ledgerCredit).toHaveBeenCalledWith({
        walletId: 99n,
        amount: 50_000n,
        reference: 'payment:7',
        description: 'Wallet topup — payment #7',
        metadata: { paymentId: '7' },
      });
    });

    it('credits exactly once when called twice (idempotency check)', async () => {
      // First call: no existing entry → credits
      const first = build({ payment: buildPayment() });
      await first.reconciler.reconcile(7n);
      expect(first.ledgerCredit).toHaveBeenCalledTimes(1);

      // Second call: idempotency check finds the existing entry → no-op
      const second = build({
        payment: buildPayment(),
        existingLedgerEntry: { id: 1234n },
      });
      await second.reconciler.reconcile(7n);
      expect(second.ledgerFindFirst).toHaveBeenCalledWith({
        where: { reference: 'payment:7' },
        select: { id: true },
      });
      expect(second.walletsFindOrCreate).not.toHaveBeenCalled();
      expect(second.ledgerCredit).not.toHaveBeenCalled();
    });
  });

  describe('subscription / order purposes', () => {
    it('does NOT touch the wallet for purpose=subscription (module fulfils)', async () => {
      const harness = build({ payment: buildPayment({ purpose: 'subscription' }) });

      await harness.reconciler.reconcile(7n);

      expect(harness.walletsFindOrCreate).not.toHaveBeenCalled();
      expect(harness.ledgerCredit).not.toHaveBeenCalled();
    });

    it('does NOT touch the wallet for purpose=order:* (module fulfils)', async () => {
      const harness = build({ payment: buildPayment({ purpose: 'order:abc-123' }) });

      await harness.reconciler.reconcile(7n);

      expect(harness.walletsFindOrCreate).not.toHaveBeenCalled();
      expect(harness.ledgerCredit).not.toHaveBeenCalled();
    });
  });

  describe('unknown purpose', () => {
    it('logs a warning and does nothing for an unrecognised purpose', async () => {
      const harness = build({ payment: buildPayment({ purpose: 'mystery_thing' }) });

      await harness.reconciler.reconcile(7n);

      expect(harness.walletsFindOrCreate).not.toHaveBeenCalled();
      expect(harness.ledgerCredit).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("unknown purpose 'mystery_thing'"),
      );
    });
  });

  describe('missing payment', () => {
    it('warns and returns early if the payment row cannot be found', async () => {
      const harness = build({ payment: null });

      await harness.reconciler.reconcile(404n);

      expect(harness.ledgerFindFirst).not.toHaveBeenCalled();
      expect(harness.walletsFindOrCreate).not.toHaveBeenCalled();
      expect(harness.ledgerCredit).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });
  });
});
