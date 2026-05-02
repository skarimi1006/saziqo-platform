import { HttpException, HttpStatus } from '@nestjs/common';
import { PaymentStatus, RefundStatus } from '@prisma/client';

import { ErrorCode } from '../../common/types/response.types';
import { ConfigService } from '../../config/config.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';

import { PaymentLedgerReconciler } from './payment-ledger.reconciler';
import type { PaymentProvider, InitiateOutput } from './payment-provider.interface';
import { PaymentsService } from './payments.service';

function buildConfig(values: Record<string, string | number | boolean> = {}): ConfigService {
  return {
    get: jest.fn().mockImplementation((key: string) => values[key]),
  } as unknown as ConfigService;
}

function buildProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  return {
    name: 'test',
    initiate: jest.fn().mockResolvedValue({
      providerReference: 'test-ref-001',
      redirectUrl: 'https://gateway.test/pay/test-ref-001',
    } satisfies InitiateOutput),
    verify: jest.fn(),
    refund: jest.fn(),
    ...overrides,
  };
}

function buildNotifications(): NotificationsService {
  return {
    dispatch: jest.fn().mockResolvedValue({ dispatched: [], failures: [] }),
  } as unknown as NotificationsService;
}

function buildReconciler(): PaymentLedgerReconciler {
  return {
    reconcile: jest.fn().mockResolvedValue(undefined),
  } as unknown as PaymentLedgerReconciler;
}

function buildWallets(overrides: Partial<WalletsService> = {}): WalletsService {
  return {
    findOrCreateForUser: jest.fn().mockResolvedValue({
      id: 99n,
      userId: 1n,
      balance: 50_000n,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    findByUserId: jest.fn(),
    findByUserIdForAdmin: jest.fn(),
    ...overrides,
  } as unknown as WalletsService;
}

function buildLedger(overrides: Partial<LedgerService> = {}): LedgerService {
  return {
    credit: jest.fn().mockResolvedValue({}),
    debit: jest.fn().mockResolvedValue({}),
    transfer: jest.fn(),
    getBalance: jest.fn(),
    verifyBalance: jest.fn(),
    findEntriesForWallet: jest.fn(),
    reconciliationReport: jest.fn(),
    aggregates: jest.fn(),
    ...overrides,
  } as unknown as LedgerService;
}

function buildPrisma(overrides: Record<string, unknown> = {}): PrismaService {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        phone: '+989121234567',
        email: 'user@test.com',
      }),
    },
    payment: {
      create: jest.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 1n,
          userId: args.data.userId ?? 1n,
          amount: args.data.amount ?? 50_000n,
          purpose: args.data.purpose ?? 'wallet_topup',
          description: args.data.description ?? 'test',
          status: PaymentStatus.PENDING,
          providerName: 'test',
          providerReference: null,
          referenceCode: null,
          cardPanMasked: null,
          metadata: args.data.metadata ?? {},
          initiatedAt: new Date(),
          completedAt: null,
          failureReason: null,
        }),
      ),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    // Mocks the prisma.$transaction(async (tx) => …) callback form by
    // invoking the callback with the same prisma stub as the tx client.
    $transaction: jest.fn().mockImplementation(async (cb: (tx: PrismaService) => unknown) => {
      return cb({
        payment: {
          update: jest.fn().mockResolvedValue({}),
        },
      } as unknown as PrismaService);
    }),
    ...overrides,
  } as unknown as PrismaService;
}

describe('PaymentsService', () => {
  describe('initiate', () => {
    it('creates a PENDING payment and returns paymentId + redirectUrl', async () => {
      const provider = buildProvider();
      const prisma = buildPrisma();
      const config = buildConfig({ PORT_API: 3001 });

      const service = new PaymentsService(
        prisma,
        config,
        buildNotifications(),
        buildReconciler(),
        buildWallets(),
        buildLedger(),
        provider,
      );

      const result = await service.initiate({
        userId: 1n,
        amount: 50_000n,
        purpose: 'wallet_topup',
        description: 'Top up wallet',
      });

      expect(result.paymentId).toBe(1n);
      expect(result.redirectUrl).toBe('https://gateway.test/pay/test-ref-001');
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 1n,
            amount: 50_000n,
            purpose: 'wallet_topup',
            status: PaymentStatus.PENDING,
          }),
        }),
      );
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1n },
          data: { providerReference: 'test-ref-001' },
        }),
      );
    });

    it('marks payment FAILED and throws on provider error', async () => {
      const provider = buildProvider({
        initiate: jest.fn().mockRejectedValue(new Error('Gateway timeout')),
      });
      const prisma = buildPrisma();
      const config = buildConfig({ PORT_API: 3001 });

      const service = new PaymentsService(
        prisma,
        config,
        buildNotifications(),
        buildReconciler(),
        buildWallets(),
        buildLedger(),
        provider,
      );

      await expect(
        service.initiate({
          userId: 1n,
          amount: 10_000n,
          purpose: 'wallet_topup',
          description: 'test',
        }),
      ).rejects.toThrow(HttpException);

      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: PaymentStatus.FAILED,
            failureReason: expect.stringContaining('Gateway timeout'),
          }),
        }),
      );
    });

    it('rejects invalid purpose format', async () => {
      const provider = buildProvider();
      const prisma = buildPrisma();
      const config = buildConfig({ PORT_API: 3001 });

      const service = new PaymentsService(
        prisma,
        config,
        buildNotifications(),
        buildReconciler(),
        buildWallets(),
        buildLedger(),
        provider,
      );

      await expect(
        service.initiate({
          userId: 1n,
          amount: 10_000n,
          purpose: 'INVALID PURPOSE',
          description: 'test',
        }),
      ).rejects.toThrow(HttpException);

      try {
        await service.initiate({
          userId: 1n,
          amount: 10_000n,
          purpose: 'INVALID PURPOSE',
          description: 'test',
        });
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        const exc = e as HttpException;
        expect(exc.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        const body = exc.getResponse() as { code: string };
        expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
      }
    });

    it('accepts valid purpose formats including module:* pattern', async () => {
      const provider = buildProvider();
      const prisma = buildPrisma();
      const config = buildConfig({ PORT_API: 3001 });

      const service = new PaymentsService(
        prisma,
        config,
        buildNotifications(),
        buildReconciler(),
        buildWallets(),
        buildLedger(),
        provider,
      );

      for (const purpose of ['wallet_topup', 'subscription', 'order:12345']) {
        const result = await service.initiate({
          userId: 1n,
          amount: 10_000n,
          purpose,
          description: 'test',
        });
        expect(result.paymentId).toBe(1n);
      }
    });

    it('passes user mobile and email to provider for gateway pre-fill', async () => {
      const provider = buildProvider();
      const prisma = buildPrisma();
      const config = buildConfig({ PORT_API: 3001 });

      const service = new PaymentsService(
        prisma,
        config,
        buildNotifications(),
        buildReconciler(),
        buildWallets(),
        buildLedger(),
        provider,
      );

      await service.initiate({
        userId: 1n,
        amount: 10_000n,
        purpose: 'wallet_topup',
        description: 'test',
      });

      expect(provider.initiate).toHaveBeenCalledWith(
        expect.objectContaining({
          userMobile: '+989121234567',
          userEmail: 'user@test.com',
        }),
      );
    });

    it('uses ZARINPAL_CALLBACK_URL to build callback URL when configured', async () => {
      const provider = buildProvider();
      const prisma = buildPrisma();
      const config = buildConfig({
        PORT_API: 3001,
        ZARINPAL_CALLBACK_URL: 'https://app.saziqo.ir/api/v1/payments/callback',
      });

      const service = new PaymentsService(
        prisma,
        config,
        buildNotifications(),
        buildReconciler(),
        buildWallets(),
        buildLedger(),
        provider,
      );

      await service.initiate({
        userId: 1n,
        amount: 10_000n,
        purpose: 'wallet_topup',
        description: 'test',
      });

      expect(provider.initiate).toHaveBeenCalledWith(
        expect.objectContaining({
          callbackUrl: 'https://app.saziqo.ir/api/v1/payments/1/callback',
        }),
      );
    });
  });

  describe('findById', () => {
    it('returns the payment for the owner', async () => {
      const payment = {
        id: 42n,
        userId: 1n,
        amount: 10_000n,
        status: PaymentStatus.PENDING,
      };
      const prisma = buildPrisma({
        payment: {
          ...buildPrisma().payment,
          findUnique: jest.fn().mockResolvedValue(payment),
        },
      });
      const config = buildConfig({ PORT_API: 3001 });

      const service = new PaymentsService(
        prisma,
        config,
        buildNotifications(),
        buildReconciler(),
        buildWallets(),
        buildLedger(),
        buildProvider(),
      );
      const result = await service.findById(42n, 1n);
      expect(result.id).toBe(42n);
    });

    it('throws NOT_FOUND for a non-owner', async () => {
      const payment = {
        id: 42n,
        userId: 1n,
        amount: 10_000n,
        status: PaymentStatus.PENDING,
      };
      const prisma = buildPrisma({
        payment: {
          ...buildPrisma().payment,
          findUnique: jest.fn().mockResolvedValue(payment),
        },
      });
      const config = buildConfig({ PORT_API: 3001 });

      const service = new PaymentsService(
        prisma,
        config,
        buildNotifications(),
        buildReconciler(),
        buildWallets(),
        buildLedger(),
        buildProvider(),
      );
      await expect(service.findById(42n, 999n)).rejects.toThrow(HttpException);

      try {
        await service.findById(42n, 999n);
      } catch (e) {
        const exc = e as HttpException;
        expect(exc.getStatus()).toBe(HttpStatus.NOT_FOUND);
      }
    });

    it('allows admin bypass when userId is undefined', async () => {
      const payment = {
        id: 42n,
        userId: 1n,
        amount: 10_000n,
        status: PaymentStatus.PENDING,
      };
      const prisma = buildPrisma({
        payment: {
          ...buildPrisma().payment,
          findUnique: jest.fn().mockResolvedValue(payment),
        },
      });
      const config = buildConfig({ PORT_API: 3001 });

      const service = new PaymentsService(
        prisma,
        config,
        buildNotifications(),
        buildReconciler(),
        buildWallets(),
        buildLedger(),
        buildProvider(),
      );
      const result = await service.findById(42n);
      expect(result.id).toBe(42n);
    });
  });

  describe('findForUser', () => {
    it('returns paginated results', async () => {
      const items = [
        { id: 3n, userId: 1n },
        { id: 2n, userId: 1n },
        { id: 1n, userId: 1n },
      ];
      const prisma = buildPrisma({
        payment: {
          ...buildPrisma().payment,
          findMany: jest.fn().mockResolvedValue(items),
        },
      });
      const config = buildConfig({ PORT_API: 3001 });

      const service = new PaymentsService(
        prisma,
        config,
        buildNotifications(),
        buildReconciler(),
        buildWallets(),
        buildLedger(),
        buildProvider(),
      );
      const page = await service.findForUser(1n, { limit: 20 });
      expect(page.items).toHaveLength(3);
      expect(page.hasMore).toBe(false);
    });
  });

  describe('handleCallback', () => {
    function buildPendingPayment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        id: 7n,
        userId: 1n,
        amount: 50_000n,
        purpose: 'wallet_topup',
        description: 'top up',
        status: PaymentStatus.PENDING,
        providerName: 'test',
        providerReference: 'auth-7',
        referenceCode: null,
        cardPanMasked: null,
        metadata: {},
        initiatedAt: new Date(),
        completedAt: null,
        failureReason: null,
        ...overrides,
      };
    }

    function setupService(opts: {
      payment: Record<string, unknown> | null;
      verifyResponse?: {
        verified: boolean;
        referenceCode?: string;
        cardPan?: string;
        failureReason?: string;
      };
      verifyThrows?: Error;
    }): {
      service: PaymentsService;
      prisma: PrismaService;
      provider: PaymentProvider;
      notifications: NotificationsService;
      reconciler: PaymentLedgerReconciler;
    } {
      const provider = buildProvider({
        verify: opts.verifyThrows
          ? jest.fn().mockRejectedValue(opts.verifyThrows)
          : jest.fn().mockResolvedValue(
              opts.verifyResponse ?? {
                verified: true,
                referenceCode: 'BANK-1',
                cardPan: '****1234',
              },
            ),
      });
      const notifications = buildNotifications();
      const reconciler = buildReconciler();
      const prisma = buildPrisma({
        payment: {
          ...buildPrisma().payment,
          findUnique: jest.fn().mockResolvedValue(opts.payment),
          update: jest.fn().mockResolvedValue({}),
        },
      });
      const config = buildConfig({ PORT_API: 3001 });
      const wallets = buildWallets();
      const ledger = buildLedger();
      const service = new PaymentsService(
        prisma,
        config,
        notifications,
        reconciler,
        wallets,
        ledger,
        provider,
      );
      return { service, prisma, provider, notifications, reconciler };
    }

    it('marks payment SUCCEEDED, calls reconciler, and dispatches IN_APP+SMS on verified=true', async () => {
      const payment = buildPendingPayment();
      const { service, prisma, notifications, reconciler } = setupService({
        payment,
        verifyResponse: { verified: true, referenceCode: 'BANK-9', cardPan: '****1234' },
      });

      const result = await service.handleCallback({
        paymentId: 7n,
        providerReference: 'auth-7',
        providerStatus: 'OK',
      });

      expect(result.status).toBe(PaymentStatus.SUCCEEDED);
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(reconciler.reconcile).toHaveBeenCalledWith(7n);
      expect(notifications.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1n,
          type: 'PAYMENT_SUCCEEDED',
          channels: ['IN_APP', 'SMS'],
          payload: expect.objectContaining({ amount: 50_000n, reference: 'BANK-9' }),
        }),
      );
    });

    it('returns existing terminal status idempotently without reprocessing', async () => {
      const payment = buildPendingPayment({
        status: PaymentStatus.SUCCEEDED,
        completedAt: new Date(),
      });
      const { service, provider, notifications, reconciler } = setupService({ payment });

      const result = await service.handleCallback({
        paymentId: 7n,
        providerReference: 'auth-7',
        providerStatus: 'OK',
      });

      expect(result.status).toBe(PaymentStatus.SUCCEEDED);
      expect(provider.verify).not.toHaveBeenCalled();
      expect(reconciler.reconcile).not.toHaveBeenCalled();
      expect(notifications.dispatch).not.toHaveBeenCalled();
    });

    it('rejects forged Authority with INVALID_CALLBACK', async () => {
      const payment = buildPendingPayment({ providerReference: 'auth-real' });
      const { service, provider } = setupService({ payment });

      await expect(
        service.handleCallback({
          paymentId: 7n,
          providerReference: 'auth-forged',
          providerStatus: 'OK',
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.INVALID_CALLBACK },
      });
      expect(provider.verify).not.toHaveBeenCalled();
    });

    it('marks CANCELLED on Status=NOK and dispatches PAYMENT_CANCELLED', async () => {
      const payment = buildPendingPayment();
      const { service, prisma, provider, notifications } = setupService({ payment });

      const result = await service.handleCallback({
        paymentId: 7n,
        providerReference: 'auth-7',
        providerStatus: 'NOK',
      });

      expect(result.status).toBe(PaymentStatus.CANCELLED);
      expect(provider.verify).not.toHaveBeenCalled();
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 7n },
          data: expect.objectContaining({ status: PaymentStatus.CANCELLED }),
        }),
      );
      expect(notifications.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PAYMENT_CANCELLED', channels: ['IN_APP'] }),
      );
    });

    it('marks FAILED with failureReason on verified=false', async () => {
      const payment = buildPendingPayment();
      const { service, prisma, notifications, reconciler } = setupService({
        payment,
        verifyResponse: { verified: false, failureReason: 'Card declined' },
      });

      const result = await service.handleCallback({
        paymentId: 7n,
        providerReference: 'auth-7',
        providerStatus: 'OK',
      });

      expect(result.status).toBe(PaymentStatus.FAILED);
      expect(reconciler.reconcile).not.toHaveBeenCalled();
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 7n },
          data: expect.objectContaining({
            status: PaymentStatus.FAILED,
            failureReason: 'Card declined',
          }),
        }),
      );
      expect(notifications.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PAYMENT_FAILED', channels: ['IN_APP'] }),
      );
    });

    it('throws NOT_FOUND for an unknown payment id', async () => {
      const { service } = setupService({ payment: null });

      await expect(
        service.handleCallback({
          paymentId: 999n,
          providerReference: 'auth-x',
          providerStatus: 'OK',
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.NOT_FOUND },
      });
    });

    it('does NOT re-credit on a re-hit callback after SUCCEEDED', async () => {
      // First call: pending → SUCCEEDED
      const pendingPayment = buildPendingPayment();
      const first = setupService({
        payment: pendingPayment,
        verifyResponse: { verified: true, referenceCode: 'BANK-1' },
      });
      const r1 = await first.service.handleCallback({
        paymentId: 7n,
        providerReference: 'auth-7',
        providerStatus: 'OK',
      });
      expect(r1.status).toBe(PaymentStatus.SUCCEEDED);
      expect(first.reconciler.reconcile).toHaveBeenCalledTimes(1);

      // Second call: payment already SUCCEEDED → no reconciler, no notification
      const finalizedPayment = buildPendingPayment({ status: PaymentStatus.SUCCEEDED });
      const second = setupService({ payment: finalizedPayment });
      const r2 = await second.service.handleCallback({
        paymentId: 7n,
        providerReference: 'auth-7',
        providerStatus: 'OK',
      });
      expect(r2.status).toBe(PaymentStatus.SUCCEEDED);
      expect(second.reconciler.reconcile).not.toHaveBeenCalled();
      expect(second.notifications.dispatch).not.toHaveBeenCalled();
    });

    it('uses HttpStatus.BAD_REQUEST for INVALID_CALLBACK', async () => {
      const payment = buildPendingPayment({ providerReference: 'auth-real' });
      const { service } = setupService({ payment });

      try {
        await service.handleCallback({
          paymentId: 7n,
          providerReference: 'auth-forged',
          providerStatus: 'OK',
        });
        fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        expect((e as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      }
    });
  });

  describe('refund', () => {
    function buildSucceededPayment(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return {
        id: 7n,
        userId: 1n,
        amount: 50_000n,
        purpose: 'wallet_topup',
        description: 'top up',
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

    function setupRefundService(opts: {
      payment: Record<string, unknown> | null;
      alreadyRefundedSum?: bigint | null;
      providerRefundResult?: { refunded: boolean };
      providerRefundThrows?: Error;
      ledgerDebitThrows?: HttpException;
      refundCreateReturn?: Record<string, unknown>;
    }): {
      service: PaymentsService;
      prisma: PrismaService;
      provider: PaymentProvider;
      notifications: NotificationsService;
      wallets: WalletsService;
      ledger: LedgerService;
      refundCreate: jest.Mock;
      refundUpdate: jest.Mock;
    } {
      const provider = buildProvider({
        refund: opts.providerRefundThrows
          ? jest.fn().mockRejectedValue(opts.providerRefundThrows)
          : jest.fn().mockResolvedValue(opts.providerRefundResult ?? { refunded: false }),
      });
      const notifications = buildNotifications();
      const reconciler = buildReconciler();
      const wallets = buildWallets();
      const ledger = buildLedger({
        debit: opts.ledgerDebitThrows
          ? jest.fn().mockRejectedValue(opts.ledgerDebitThrows)
          : jest.fn().mockResolvedValue({}),
      });

      const refundCreate = jest.fn().mockResolvedValue(
        opts.refundCreateReturn ?? {
          id: 1001n,
          paymentId: 7n,
          amount: 50_000n,
          reason: 'duplicate charge',
          status: RefundStatus.PENDING_MANUAL,
          requestedByUserId: 99n,
          requestedAt: new Date(),
          completedAt: null,
          bankReference: null,
        },
      );
      const refundUpdate = jest.fn();
      const refundFindUnique = jest.fn();

      const prisma = buildPrisma({
        payment: {
          ...buildPrisma().payment,
          findUnique: jest.fn().mockResolvedValue(opts.payment),
        },
        refund: {
          create: refundCreate,
          update: refundUpdate,
          findUnique: refundFindUnique,
          findMany: jest.fn().mockResolvedValue([]),
          aggregate: jest.fn().mockResolvedValue({
            _sum: { amount: opts.alreadyRefundedSum ?? null },
          }),
        },
      });
      const config = buildConfig({ PORT_API: 3001 });
      const service = new PaymentsService(
        prisma,
        config,
        notifications,
        reconciler,
        wallets,
        ledger,
        provider,
      );
      return {
        service,
        prisma,
        provider,
        notifications,
        wallets,
        ledger,
        refundCreate,
        refundUpdate,
      };
    }

    it('creates a PENDING_MANUAL Refund and debits wallet for wallet_topup with manual provider', async () => {
      const harness = setupRefundService({
        payment: buildSucceededPayment(),
        providerRefundThrows: new Error(ErrorCode.REFUND_NOT_SUPPORTED_BY_PROVIDER),
      });

      const refund = await harness.service.refund({
        paymentId: 7n,
        amount: 50_000n,
        reason: 'duplicate charge by user',
        actorUserId: 99n,
      });

      expect(refund.status).toBe(RefundStatus.PENDING_MANUAL);
      expect(harness.refundCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentId: 7n,
            amount: 50_000n,
            status: RefundStatus.PENDING_MANUAL,
            requestedByUserId: 99n,
            completedAt: null,
          }),
        }),
      );
      expect(harness.wallets.findOrCreateForUser).toHaveBeenCalledWith(1n);
      expect(harness.ledger.debit).toHaveBeenCalledWith({
        walletId: 99n,
        amount: 50_000n,
        reference: 'refund:1001',
        description: 'Refund — payment #7',
        metadata: { refundId: '1001', paymentId: '7' },
      });
      expect(harness.notifications.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PAYMENT_REFUNDED',
          channels: ['IN_APP', 'SMS'],
          payload: expect.objectContaining({ amount: 50_000n }),
        }),
      );
    });

    it('marks Refund COMPLETED immediately when provider returns refunded=true', async () => {
      const harness = setupRefundService({
        payment: buildSucceededPayment(),
        providerRefundResult: { refunded: true },
        refundCreateReturn: {
          id: 1001n,
          paymentId: 7n,
          amount: 50_000n,
          reason: 'auto refund',
          status: RefundStatus.COMPLETED,
          requestedByUserId: 99n,
          requestedAt: new Date(),
          completedAt: new Date(),
          bankReference: null,
        },
      });

      const refund = await harness.service.refund({
        paymentId: 7n,
        amount: 50_000n,
        reason: 'auto refund flow test',
        actorUserId: 99n,
      });

      expect(refund.status).toBe(RefundStatus.COMPLETED);
      expect(harness.refundCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: RefundStatus.COMPLETED,
            completedAt: expect.any(Date),
          }),
        }),
      );
      expect(harness.ledger.debit).toHaveBeenCalled();
    });

    it('rejects refund of a FAILED payment with PAYMENT_NOT_REFUNDABLE', async () => {
      const harness = setupRefundService({
        payment: buildSucceededPayment({ status: PaymentStatus.FAILED }),
      });

      await expect(
        harness.service.refund({
          paymentId: 7n,
          amount: 50_000n,
          reason: 'should be rejected',
          actorUserId: 99n,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.PAYMENT_NOT_REFUNDABLE },
      });
      expect(harness.refundCreate).not.toHaveBeenCalled();
    });

    it('rejects refund when amount + already-refunded exceeds payment amount', async () => {
      const harness = setupRefundService({
        payment: buildSucceededPayment({ amount: 100_000n }),
        alreadyRefundedSum: 80_000n,
      });

      // Available = 100,000 - 80,000 = 20,000. Asking for 30,000 should fail.
      await expect(
        harness.service.refund({
          paymentId: 7n,
          amount: 30_000n,
          reason: 'attempt to over-refund',
          actorUserId: 99n,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.REFUND_AMOUNT_EXCEEDS_AVAILABLE },
      });
      expect(harness.refundCreate).not.toHaveBeenCalled();
    });

    it('allows a partial refund within remaining balance', async () => {
      const harness = setupRefundService({
        payment: buildSucceededPayment({ amount: 100_000n }),
        alreadyRefundedSum: 80_000n,
        providerRefundThrows: new Error(ErrorCode.REFUND_NOT_SUPPORTED_BY_PROVIDER),
      });

      const refund = await harness.service.refund({
        paymentId: 7n,
        amount: 20_000n, // exactly the remaining
        reason: 'final partial refund',
        actorUserId: 99n,
      });

      expect(refund.status).toBe(RefundStatus.PENDING_MANUAL);
      expect(harness.refundCreate).toHaveBeenCalled();
    });

    it('defaults amount to full payment amount when not specified', async () => {
      const harness = setupRefundService({
        payment: buildSucceededPayment(),
        providerRefundThrows: new Error(ErrorCode.REFUND_NOT_SUPPORTED_BY_PROVIDER),
      });

      await harness.service.refund({
        paymentId: 7n,
        reason: 'full refund',
        actorUserId: 99n,
      });

      expect(harness.refundCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amount: 50_000n }),
        }),
      );
    });

    it('throws CANNOT_REFUND_INSUFFICIENT_BALANCE when wallet debit fails', async () => {
      const harness = setupRefundService({
        payment: buildSucceededPayment(),
        providerRefundThrows: new Error(ErrorCode.REFUND_NOT_SUPPORTED_BY_PROVIDER),
        ledgerDebitThrows: new HttpException(
          { code: ErrorCode.INSUFFICIENT_FUNDS, message: 'Insufficient wallet balance' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        ),
      });

      await expect(
        harness.service.refund({
          paymentId: 7n,
          amount: 50_000n,
          reason: 'should hit insufficient funds',
          actorUserId: 99n,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.CANNOT_REFUND_INSUFFICIENT_BALANCE },
      });
      // The Refund row IS created — admin resolves manually per the plan.
      expect(harness.refundCreate).toHaveBeenCalled();
    });

    it('skips wallet debit for non-wallet_topup purposes (subscription)', async () => {
      const harness = setupRefundService({
        payment: buildSucceededPayment({ purpose: 'subscription' }),
        providerRefundThrows: new Error(ErrorCode.REFUND_NOT_SUPPORTED_BY_PROVIDER),
      });

      await harness.service.refund({
        paymentId: 7n,
        amount: 50_000n,
        reason: 'subscription refund — module handles fulfilment',
        actorUserId: 99n,
      });

      expect(harness.ledger.debit).not.toHaveBeenCalled();
      expect(harness.refundCreate).toHaveBeenCalled();
      expect(harness.notifications.dispatch).toHaveBeenCalled();
    });

    it('returns NOT_FOUND for an unknown payment id', async () => {
      const harness = setupRefundService({ payment: null });

      await expect(
        harness.service.refund({
          paymentId: 999n,
          reason: 'should be 404',
          actorUserId: 99n,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.NOT_FOUND },
      });
    });

    it('re-throws unexpected provider refund errors instead of falling into manual mode', async () => {
      const harness = setupRefundService({
        payment: buildSucceededPayment(),
        providerRefundThrows: new Error('Gateway is down'),
      });

      await expect(
        harness.service.refund({
          paymentId: 7n,
          amount: 50_000n,
          reason: 'should re-throw',
          actorUserId: 99n,
        }),
      ).rejects.toThrow('Gateway is down');
      expect(harness.refundCreate).not.toHaveBeenCalled();
    });
  });

  describe('markRefundCompleted', () => {
    function buildPendingRefund(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        id: 1001n,
        paymentId: 7n,
        amount: 50_000n,
        reason: 'duplicate',
        status: RefundStatus.PENDING_MANUAL,
        requestedByUserId: 99n,
        requestedAt: new Date(),
        completedAt: null,
        bankReference: null,
        ...overrides,
      };
    }

    function setupMarkComplete(opts: { refund: Record<string, unknown> | null }): {
      service: PaymentsService;
      refundUpdate: jest.Mock;
    } {
      const refundUpdate = jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            ...buildPendingRefund(),
            ...data,
          }),
        );
      const prisma = buildPrisma({
        refund: {
          findUnique: jest.fn().mockResolvedValue(opts.refund),
          update: refundUpdate,
          create: jest.fn(),
          findMany: jest.fn(),
          aggregate: jest.fn(),
        },
      });
      const service = new PaymentsService(
        prisma,
        buildConfig({ PORT_API: 3001 }),
        buildNotifications(),
        buildReconciler(),
        buildWallets(),
        buildLedger(),
        buildProvider(),
      );
      return { service, refundUpdate };
    }

    it('flips PENDING_MANUAL → COMPLETED and records the bank reference', async () => {
      const { service, refundUpdate } = setupMarkComplete({ refund: buildPendingRefund() });

      const result = await service.markRefundCompleted({
        refundId: 1001n,
        bankReference: 'BANK-TX-9876',
        actorUserId: 99n,
      });

      expect(result.status).toBe(RefundStatus.COMPLETED);
      expect(result.bankReference).toBe('BANK-TX-9876');
      expect(refundUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1001n },
          data: expect.objectContaining({
            status: RefundStatus.COMPLETED,
            completedAt: expect.any(Date),
            bankReference: 'BANK-TX-9876',
          }),
        }),
      );
    });

    it('rejects mark-complete on an already-COMPLETED refund', async () => {
      const { service } = setupMarkComplete({
        refund: buildPendingRefund({ status: RefundStatus.COMPLETED }),
      });

      await expect(
        service.markRefundCompleted({
          refundId: 1001n,
          bankReference: 'BANK-X',
          actorUserId: 99n,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.REFUND_NOT_PENDING },
      });
    });

    it('returns NOT_FOUND for unknown refund id', async () => {
      const { service } = setupMarkComplete({ refund: null });

      await expect(
        service.markRefundCompleted({
          refundId: 9999n,
          bankReference: 'BANK-X',
          actorUserId: 99n,
        }),
      ).rejects.toMatchObject({
        response: { code: ErrorCode.NOT_FOUND },
      });
    });
  });
});
