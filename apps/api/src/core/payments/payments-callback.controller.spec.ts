import '../../common/bigint-serialization';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PaymentStatus } from '@prisma/client';
import request from 'supertest';

import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { ErrorCode } from '../../common/types/response.types';

import { PaymentsCallbackController } from './payments-callback.controller';
import { PaymentsService } from './payments.service';

type ServiceMock = jest.Mocked<Pick<PaymentsService, 'handleCallback'>>;

async function buildApp(serviceMock: Partial<PaymentsService>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [PaymentsCallbackController],
    providers: [{ provide: PaymentsService, useValue: serviceMock }],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

describe('PaymentsCallbackController (integration)', () => {
  let app: INestApplication;
  let serviceMock: ServiceMock;

  beforeAll(async () => {
    serviceMock = {
      handleCallback: jest.fn(),
    };
    app = await buildApp(serviceMock as unknown as Partial<PaymentsService>);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    serviceMock.handleCallback.mockReset();
  });

  it('redirects to /payment-result/{paymentId} on successful verification', async () => {
    serviceMock.handleCallback.mockResolvedValueOnce({
      paymentId: 42n,
      status: PaymentStatus.SUCCEEDED,
    });

    const res = await request(app.getHttpServer())
      .get('/payments/42/callback?Authority=auth-42&Status=OK')
      .expect(302);

    expect(res.header['location']).toBe('/payment-result/42');
    expect(serviceMock.handleCallback).toHaveBeenCalledWith({
      paymentId: 42n,
      providerReference: 'auth-42',
      providerStatus: 'OK',
    });
  });

  it('redirects on Status=NOK as well (CANCELLED handled inside service)', async () => {
    serviceMock.handleCallback.mockResolvedValueOnce({
      paymentId: 9n,
      status: PaymentStatus.CANCELLED,
    });

    const res = await request(app.getHttpServer())
      .get('/payments/9/callback?Authority=auth-9&Status=NOK')
      .expect(302);

    expect(res.header['location']).toBe('/payment-result/9');
    expect(serviceMock.handleCallback).toHaveBeenCalledWith(
      expect.objectContaining({ providerStatus: 'NOK' }),
    );
  });

  it('rejects requests missing required Authority/Status query params', async () => {
    await request(app.getHttpServer()).get('/payments/1/callback').expect(400);
    expect(serviceMock.handleCallback).not.toHaveBeenCalled();
  });

  it('rejects unknown Status values', async () => {
    await request(app.getHttpServer())
      .get('/payments/1/callback?Authority=auth-1&Status=MAYBE')
      .expect(400);
    expect(serviceMock.handleCallback).not.toHaveBeenCalled();
  });

  it('does not require authentication (public endpoint)', async () => {
    serviceMock.handleCallback.mockResolvedValueOnce({
      paymentId: 1n,
      status: PaymentStatus.SUCCEEDED,
    });

    // No Authorization header set — gateway sends the user with no JWT.
    await request(app.getHttpServer())
      .get('/payments/1/callback?Authority=auth-1&Status=OK')
      .expect(302);
  });

  it('surfaces INVALID_CALLBACK as 400 via the global exception filter', async () => {
    const { HttpException } = await import('@nestjs/common');
    serviceMock.handleCallback.mockRejectedValueOnce(
      new HttpException({ code: ErrorCode.INVALID_CALLBACK, message: 'forged' }, 400),
    );

    const res = await request(app.getHttpServer())
      .get('/payments/1/callback?Authority=wrong&Status=OK')
      .expect(400);

    expect(res.body).toMatchObject({
      error: expect.objectContaining({ code: ErrorCode.INVALID_CALLBACK }),
    });
    expect(res.header['location']).toBeUndefined();
  });
});
