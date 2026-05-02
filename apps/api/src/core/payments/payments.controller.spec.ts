import '../../common/bigint-serialization';

import { ExecutionContext, HttpException, HttpStatus, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PaymentStatus } from '@prisma/client';
import request from 'supertest';

import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { ErrorCode } from '../../common/types/response.types';

import { PaymentsController } from './payments.controller';
import { PaymentsService, type PaymentRow } from './payments.service';

const USER_A = 1n;
const USER_B = 2n;

function buildPayment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: 7n,
    userId: USER_A,
    amount: 50_000n,
    purpose: 'wallet_topup',
    description: 'Top up',
    status: PaymentStatus.SUCCEEDED,
    providerName: 'console',
    providerReference: 'auth-7',
    referenceCode: 'BANK-9',
    cardPanMasked: '****-****-****-1234',
    metadata: { foo: 'bar' },
    initiatedAt: new Date('2026-05-01T10:00:00Z'),
    completedAt: new Date('2026-05-01T10:01:00Z'),
    failureReason: null,
    ...overrides,
  };
}

function userGuard(userId: bigint) {
  return {
    canActivate(ctx: ExecutionContext) {
      ctx.switchToHttp().getRequest().user = { id: userId };
      return true;
    },
  };
}

async function buildApp(
  serviceMock: Partial<PaymentsService>,
  asUserId: bigint,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [PaymentsController],
    providers: [{ provide: PaymentsService, useValue: serviceMock }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(userGuard(asUserId))
    .overrideGuard(PermissionGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

describe('PaymentsController — status endpoint (integration)', () => {
  let appAsOwner: INestApplication;
  let appAsOther: INestApplication;
  let serviceMock: jest.Mocked<Pick<PaymentsService, 'findById'>>;

  beforeAll(async () => {
    serviceMock = {
      findById: jest.fn(),
    };
    [appAsOwner, appAsOther] = await Promise.all([
      buildApp(serviceMock as unknown as Partial<PaymentsService>, USER_A),
      buildApp(serviceMock as unknown as Partial<PaymentsService>, USER_B),
    ]);
  });

  afterAll(async () => {
    await Promise.all([appAsOwner.close(), appAsOther.close()]);
  });

  beforeEach(() => {
    serviceMock.findById.mockReset();
  });

  describe('GET /payments/:paymentId/status', () => {
    it('returns sanitized status for the owner (id, status, amount, referenceCode, completedAt)', async () => {
      serviceMock.findById.mockResolvedValueOnce(buildPayment());

      const res = await request(appAsOwner.getHttpServer()).get('/payments/7/status').expect(200);

      expect(serviceMock.findById).toHaveBeenCalledWith(7n, USER_A);
      expect(res.body.data).toEqual({
        id: '7',
        status: PaymentStatus.SUCCEEDED,
        amount: '50000',
        referenceCode: 'BANK-9',
        completedAt: '2026-05-01T10:01:00.000Z',
      });
      // Sanitization: providerReference, cardPanMasked, failureReason,
      // metadata, providerName must NOT leak through this endpoint.
      expect(res.body.data).not.toHaveProperty('providerReference');
      expect(res.body.data).not.toHaveProperty('cardPanMasked');
      expect(res.body.data).not.toHaveProperty('failureReason');
      expect(res.body.data).not.toHaveProperty('metadata');
      expect(res.body.data).not.toHaveProperty('providerName');
    });

    it('returns SUCCEEDED status for a subscription payment so modules can poll', async () => {
      // Module fulfilment: when purpose=subscription, the reconciler does
      // not touch the ledger; the originating module reads the status
      // endpoint and grants its subscription on its own.
      serviceMock.findById.mockResolvedValueOnce(
        buildPayment({ purpose: 'subscription', status: PaymentStatus.SUCCEEDED }),
      );

      const res = await request(appAsOwner.getHttpServer()).get('/payments/7/status').expect(200);

      expect(res.body.data.status).toBe(PaymentStatus.SUCCEEDED);
    });

    it('returns the current status (PENDING → SUCCEEDED) on consecutive polls', async () => {
      serviceMock.findById
        .mockResolvedValueOnce(
          buildPayment({ status: PaymentStatus.PENDING, completedAt: null, referenceCode: null }),
        )
        .mockResolvedValueOnce(buildPayment({ status: PaymentStatus.SUCCEEDED }));

      const r1 = await request(appAsOwner.getHttpServer()).get('/payments/7/status').expect(200);
      expect(r1.body.data.status).toBe(PaymentStatus.PENDING);
      expect(r1.body.data.completedAt).toBeNull();

      const r2 = await request(appAsOwner.getHttpServer()).get('/payments/7/status').expect(200);
      expect(r2.body.data.status).toBe(PaymentStatus.SUCCEEDED);
      expect(r2.body.data.referenceCode).toBe('BANK-9');
    });

    it("returns 404 NOT_FOUND when user B asks about user A's payment (no existence leak)", async () => {
      // findById throws NOT_FOUND when userId does not match — by design,
      // not FORBIDDEN, so callers cannot infer that the payment exists.
      serviceMock.findById.mockRejectedValueOnce(
        new HttpException(
          { code: ErrorCode.NOT_FOUND, message: 'Payment not found' },
          HttpStatus.NOT_FOUND,
        ),
      );

      const res = await request(appAsOther.getHttpServer()).get('/payments/7/status').expect(404);

      expect(res.body).toMatchObject({
        error: expect.objectContaining({ code: ErrorCode.NOT_FOUND }),
      });
      expect(serviceMock.findById).toHaveBeenCalledWith(7n, USER_B);
    });

    it('returns 404 NOT_FOUND for a non-existent payment id', async () => {
      serviceMock.findById.mockRejectedValueOnce(
        new HttpException(
          { code: ErrorCode.NOT_FOUND, message: 'Payment not found' },
          HttpStatus.NOT_FOUND,
        ),
      );

      await request(appAsOwner.getHttpServer()).get('/payments/999/status').expect(404);
    });

    it('returns 404 for a non-numeric payment id without crashing the parser', async () => {
      await request(appAsOwner.getHttpServer()).get('/payments/not-a-number/status').expect(404);
      expect(serviceMock.findById).not.toHaveBeenCalled();
    });
  });
});
