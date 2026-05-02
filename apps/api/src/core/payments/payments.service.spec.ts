import { HttpException, HttpStatus } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';

import { ErrorCode } from '../../common/types/response.types';
import { ConfigService } from '../../config/config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

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
      const service = new PaymentsService(prisma, config, notifications, reconciler, provider);
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
});
