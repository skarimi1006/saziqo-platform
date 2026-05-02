import { HttpException, HttpStatus } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';

import { ErrorCode } from '../../common/types/response.types';
import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

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
    ...overrides,
  } as unknown as PrismaService;
}

describe('PaymentsService', () => {
  describe('initiate', () => {
    it('creates a PENDING payment and returns paymentId + redirectUrl', async () => {
      const provider = buildProvider();
      const prisma = buildPrisma();
      const config = buildConfig({ PORT_API: 3001 });

      const service = new PaymentsService(prisma, config, provider);

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

      const service = new PaymentsService(prisma, config, provider);

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

      const service = new PaymentsService(prisma, config, provider);

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

      const service = new PaymentsService(prisma, config, provider);

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

      const service = new PaymentsService(prisma, config, provider);

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

      const service = new PaymentsService(prisma, config, provider);

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

      const service = new PaymentsService(prisma, config, buildProvider());
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

      const service = new PaymentsService(prisma, config, buildProvider());
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

      const service = new PaymentsService(prisma, config, buildProvider());
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

      const service = new PaymentsService(prisma, config, buildProvider());
      const page = await service.findForUser(1n, { limit: 20 });
      expect(page.items).toHaveLength(3);
      expect(page.hasMore).toBe(false);
    });
  });
});
