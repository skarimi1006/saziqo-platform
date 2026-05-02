import '../../common/bigint-serialization';

import { ExecutionContext, HttpException, HttpStatus, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RefundStatus } from '@prisma/client';
import request from 'supertest';

import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { ErrorCode } from '../../common/types/response.types';

import { AdminPaymentsController, AdminRefundsController } from './payments.controller';
import { PaymentsService, type RefundRow } from './payments.service';

const ADMIN_ID = 99n;

function buildRefund(overrides: Partial<RefundRow> = {}): RefundRow {
  return {
    id: 1001n,
    paymentId: 7n,
    amount: 50_000n,
    reason: 'duplicate charge — user contacted support',
    status: RefundStatus.PENDING_MANUAL,
    requestedByUserId: ADMIN_ID,
    requestedAt: new Date('2026-05-01T12:00:00Z'),
    completedAt: null,
    bankReference: null,
    ...overrides,
  };
}

const adminGuard = {
  canActivate(ctx: ExecutionContext) {
    ctx.switchToHttp().getRequest().user = { id: ADMIN_ID };
    return true;
  },
};

async function buildApp(serviceMock: Partial<PaymentsService>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminPaymentsController, AdminRefundsController],
    providers: [{ provide: PaymentsService, useValue: serviceMock }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(adminGuard)
    .overrideGuard(PermissionGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

describe('Admin refund controllers (integration)', () => {
  let app: INestApplication;
  let serviceMock: jest.Mocked<
    Pick<PaymentsService, 'refund' | 'markRefundCompleted' | 'findRefundsForAdmin'>
  >;

  beforeAll(async () => {
    serviceMock = {
      refund: jest.fn(),
      markRefundCompleted: jest.fn(),
      findRefundsForAdmin: jest.fn(),
    };
    app = await buildApp(serviceMock as unknown as Partial<PaymentsService>);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    serviceMock.refund.mockReset();
    serviceMock.markRefundCompleted.mockReset();
    serviceMock.findRefundsForAdmin.mockReset();
  });

  describe('POST /admin/payments/:paymentId/refund', () => {
    it('passes amount, reason, and actorUserId to the service and returns the refund', async () => {
      serviceMock.refund.mockResolvedValueOnce(buildRefund());

      const res = await request(app.getHttpServer())
        .post('/admin/payments/7/refund')
        .send({ amount: '50000', reason: 'duplicate charge — user contacted support' })
        .expect(201);

      expect(serviceMock.refund).toHaveBeenCalledWith({
        paymentId: 7n,
        amount: 50_000n,
        reason: 'duplicate charge — user contacted support',
        actorUserId: ADMIN_ID,
      });
      expect(res.body.data).toMatchObject({
        id: '1001',
        paymentId: '7',
        amount: '50000',
        status: RefundStatus.PENDING_MANUAL,
      });
    });

    it('omits amount → service receives undefined (defaults to full payment amount)', async () => {
      serviceMock.refund.mockResolvedValueOnce(buildRefund());

      await request(app.getHttpServer())
        .post('/admin/payments/7/refund')
        .send({ reason: 'no amount = full refund please' })
        .expect(201);

      expect(serviceMock.refund).toHaveBeenCalledWith({
        paymentId: 7n,
        reason: 'no amount = full refund please',
        actorUserId: ADMIN_ID,
      });
    });

    it('rejects a reason shorter than 10 characters', async () => {
      await request(app.getHttpServer())
        .post('/admin/payments/7/refund')
        .send({ amount: '50000', reason: 'short' })
        .expect(400);
      expect(serviceMock.refund).not.toHaveBeenCalled();
    });

    it('surfaces REFUND_AMOUNT_EXCEEDS_AVAILABLE as 422 from the service', async () => {
      serviceMock.refund.mockRejectedValueOnce(
        new HttpException(
          { code: ErrorCode.REFUND_AMOUNT_EXCEEDS_AVAILABLE, message: 'too much' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        ),
      );

      const res = await request(app.getHttpServer())
        .post('/admin/payments/7/refund')
        .send({ amount: '99999999', reason: 'attempting to over-refund the payment' })
        .expect(422);

      expect(res.body).toMatchObject({
        error: expect.objectContaining({ code: ErrorCode.REFUND_AMOUNT_EXCEEDS_AVAILABLE }),
      });
    });
  });

  describe('PATCH /admin/refunds/:id/mark-completed', () => {
    it('flips refund to COMPLETED with the supplied bank reference', async () => {
      serviceMock.markRefundCompleted.mockResolvedValueOnce(
        buildRefund({
          status: RefundStatus.COMPLETED,
          completedAt: new Date('2026-05-02T10:00:00Z'),
          bankReference: 'BANK-TX-9876',
        }),
      );

      const res = await request(app.getHttpServer())
        .patch('/admin/refunds/1001/mark-completed')
        .send({ bankReference: 'BANK-TX-9876' })
        .expect(200);

      expect(serviceMock.markRefundCompleted).toHaveBeenCalledWith({
        refundId: 1001n,
        bankReference: 'BANK-TX-9876',
        actorUserId: ADMIN_ID,
      });
      expect(res.body.data).toMatchObject({
        id: '1001',
        status: RefundStatus.COMPLETED,
        bankReference: 'BANK-TX-9876',
      });
    });

    it('rejects requests without a bankReference', async () => {
      await request(app.getHttpServer())
        .patch('/admin/refunds/1001/mark-completed')
        .send({})
        .expect(400);
      expect(serviceMock.markRefundCompleted).not.toHaveBeenCalled();
    });
  });

  describe('GET /admin/refunds', () => {
    it('returns paginated refunds with status filter passed to the service', async () => {
      serviceMock.findRefundsForAdmin.mockResolvedValueOnce({
        items: [buildRefund(), buildRefund({ id: 1002n })],
        nextCursor: null,
        hasMore: false,
      });

      const res = await request(app.getHttpServer())
        .get('/admin/refunds?status=PENDING_MANUAL&limit=10')
        .expect(200);

      expect(serviceMock.findRefundsForAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ status: RefundStatus.PENDING_MANUAL, limit: 10 }),
      );
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.pagination).toMatchObject({ limit: 10 });
    });
  });
});
