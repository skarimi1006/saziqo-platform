import { Logger } from '@nestjs/common';

import { ErrorCode } from '../../common/types/response.types';
import { ConfigService } from '../../config/config.service';
import { RedisService } from '../redis/redis.service';

import { ConsolePaymentProvider } from './providers/console.provider';
import { ZarinPalProvider } from './providers/zarinpal.provider';

type FetchFn = typeof globalThis.fetch;

function mockFetchOnce(responses: Array<{ status: number; body?: unknown }>): jest.Mock {
  const fn = jest.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      status: r.status,
      json: async () => r.body ?? {},
    } as unknown as Response);
  }
  return fn;
}

function buildConfig(values: Record<string, string | number | boolean>): ConfigService {
  return {
    get: jest.fn().mockImplementation((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('ZarinPalProvider', () => {
  const merchantId = '00000000-0000-0000-0000-000000000001';
  let originalFetch: FetchFn | undefined;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
    logSpy.mockRestore();
  });

  describe('initiate', () => {
    it('posts the documented body shape and returns the StartPay redirect URL', async () => {
      const fetchMock = mockFetchOnce([
        {
          status: 200,
          body: { data: { code: 100, message: 'OK', authority: 'A0000000001' }, errors: [] },
        },
      ]);
      globalThis.fetch = fetchMock as unknown as FetchFn;

      const provider = new ZarinPalProvider(buildConfig({ ZARINPAL_MERCHANT_ID: merchantId }));

      const out = await provider.initiate({
        amount: 50_000n,
        description: 'subscription',
        callbackUrl: 'https://app.saziqo.ir/api/v1/payments/cb',
        referenceId: '123',
        userMobile: '+989121234567',
        userEmail: 'a@b.com',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.zarinpal.com/pg/v4/payment/request.json');
      expect(init.method).toBe('POST');
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        merchant_id: merchantId,
        amount: 50_000,
        description: 'subscription',
        callback_url: 'https://app.saziqo.ir/api/v1/payments/cb',
        metadata: { mobile: '+989121234567', email: 'a@b.com', order_id: '123' },
      });

      expect(out.providerReference).toBe('A0000000001');
      expect(out.redirectUrl).toBe('https://www.zarinpal.com/pg/StartPay/A0000000001');
    });

    it('throws PAYMENT_INITIATION_FAILED on non-100 gateway response', async () => {
      globalThis.fetch = mockFetchOnce([
        {
          status: 200,
          body: { data: [], errors: { code: -9, message: 'merchant_id invalid' } },
        },
      ]) as unknown as FetchFn;

      const provider = new ZarinPalProvider(buildConfig({ ZARINPAL_MERCHANT_ID: merchantId }));

      await expect(
        provider.initiate({
          amount: 1_000n,
          description: 'x',
          callbackUrl: 'https://x',
          referenceId: 'r',
        }),
      ).rejects.toThrow(ErrorCode.PAYMENT_INITIATION_FAILED);
    });

    it('throws PAYMENT_INITIATION_FAILED when merchant id is not configured', async () => {
      globalThis.fetch = jest.fn() as unknown as FetchFn;
      const provider = new ZarinPalProvider(buildConfig({}));

      await expect(
        provider.initiate({
          amount: 1n,
          description: 'x',
          callbackUrl: 'https://x',
          referenceId: 'r',
        }),
      ).rejects.toThrow(/ZARINPAL_MERCHANT_ID/);
    });

    it('retries once on HTTP 5xx and succeeds on the second call', async () => {
      const fetchMock = mockFetchOnce([
        { status: 502 },
        {
          status: 200,
          body: { data: { code: 100, authority: 'A99' }, errors: [] },
        },
      ]);
      globalThis.fetch = fetchMock as unknown as FetchFn;

      const provider = new ZarinPalProvider(buildConfig({ ZARINPAL_MERCHANT_ID: merchantId }));

      const out = await provider.initiate({
        amount: 1n,
        description: 'x',
        callbackUrl: 'https://x',
        referenceId: 'r',
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(out.providerReference).toBe('A99');
    });

    it('does NOT retry on HTTP 4xx', async () => {
      const fetchMock = mockFetchOnce([{ status: 400, body: { data: [], errors: {} } }]);
      globalThis.fetch = fetchMock as unknown as FetchFn;

      const provider = new ZarinPalProvider(buildConfig({ ZARINPAL_MERCHANT_ID: merchantId }));

      await expect(
        provider.initiate({
          amount: 1n,
          description: 'x',
          callbackUrl: 'https://x',
          referenceId: 'r',
        }),
      ).rejects.toThrow(ErrorCode.PAYMENT_INITIATION_FAILED);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws PAYMENT_INITIATION_FAILED after a second 5xx', async () => {
      const fetchMock = mockFetchOnce([{ status: 503 }, { status: 503 }]);
      globalThis.fetch = fetchMock as unknown as FetchFn;

      const provider = new ZarinPalProvider(buildConfig({ ZARINPAL_MERCHANT_ID: merchantId }));

      await expect(
        provider.initiate({
          amount: 1n,
          description: 'x',
          callbackUrl: 'https://x',
          referenceId: 'r',
        }),
      ).rejects.toThrow(/HTTP 503/);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('verify', () => {
    it('returns verified=true with referenceCode and cardPan on code 100', async () => {
      globalThis.fetch = mockFetchOnce([
        {
          status: 200,
          body: {
            data: { code: 100, message: 'OK', ref_id: 9876543210, card_pan: '6037-99**-**-1234' },
            errors: [],
          },
        },
      ]) as unknown as FetchFn;

      const provider = new ZarinPalProvider(buildConfig({ ZARINPAL_MERCHANT_ID: merchantId }));

      const out = await provider.verify({
        providerReference: 'A0000000001',
        expectedAmount: 50_000n,
      });

      expect(out.verified).toBe(true);
      expect(out.referenceCode).toBe('9876543210');
      expect(out.cardPan).toBe('6037-99**-**-1234');
    });

    it('returns verified=true on code 101 (already verified — idempotent)', async () => {
      globalThis.fetch = mockFetchOnce([
        {
          status: 200,
          body: { data: { code: 101, message: 'verified', ref_id: 1 }, errors: [] },
        },
      ]) as unknown as FetchFn;

      const provider = new ZarinPalProvider(buildConfig({ ZARINPAL_MERCHANT_ID: merchantId }));

      const out = await provider.verify({
        providerReference: 'A0000000001',
        expectedAmount: 50_000n,
      });

      expect(out.verified).toBe(true);
      expect(out.referenceCode).toBe('1');
    });

    it('returns verified=false with failureReason on non-100/101 codes', async () => {
      globalThis.fetch = mockFetchOnce([
        {
          status: 200,
          body: { data: { code: -50, message: 'amount mismatch' }, errors: [] },
        },
      ]) as unknown as FetchFn;

      const provider = new ZarinPalProvider(buildConfig({ ZARINPAL_MERCHANT_ID: merchantId }));

      const out = await provider.verify({
        providerReference: 'A0000000001',
        expectedAmount: 50_000n,
      });

      expect(out.verified).toBe(false);
      expect(out.failureReason).toBe('amount mismatch');
    });

    it('posts merchant_id, amount, and authority in the body', async () => {
      const fetchMock = mockFetchOnce([
        { status: 200, body: { data: { code: 100, ref_id: 1 }, errors: [] } },
      ]);
      globalThis.fetch = fetchMock as unknown as FetchFn;

      const provider = new ZarinPalProvider(buildConfig({ ZARINPAL_MERCHANT_ID: merchantId }));
      await provider.verify({ providerReference: 'A77', expectedAmount: 12_345n });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.zarinpal.com/pg/v4/payment/verify.json');
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toEqual({
        merchant_id: merchantId,
        amount: 12_345,
        authority: 'A77',
      });
    });
  });

  describe('refund', () => {
    it('always throws REFUND_NOT_SUPPORTED_BY_PROVIDER', async () => {
      const provider = new ZarinPalProvider(buildConfig({ ZARINPAL_MERCHANT_ID: merchantId }));
      await expect(
        provider.refund({ providerReference: 'A1', amount: 100n, reason: 'requested' }),
      ).rejects.toThrow(ErrorCode.REFUND_NOT_SUPPORTED_BY_PROVIDER);
    });
  });
});

describe('ConsolePaymentProvider', () => {
  function build(redisGetReturn: string | null): {
    provider: ConsolePaymentProvider;
    getMock: jest.Mock;
  } {
    const getMock = jest.fn().mockResolvedValue(redisGetReturn);
    const redis = {
      getClient: () => ({ get: getMock }),
    } as unknown as RedisService;
    const config = buildConfig({ PORT_WEB: 3000 });
    return { provider: new ConsolePaymentProvider(redis, config), getMock };
  }

  it('initiate returns a simulator URL containing the referenceId', async () => {
    const { provider } = build(null);
    const out = await provider.initiate({
      amount: 1_000n,
      description: 'x',
      callbackUrl: 'https://x',
      referenceId: 'order-42',
    });

    expect(out.redirectUrl).toContain('/_dev/payment-simulator');
    expect(out.redirectUrl).toContain('ref=order-42');
    expect(out.providerReference).toMatch(/^dev-[0-9a-f-]{36}$/);
  });

  it('verify reads dev:payment:{providerReference} from Redis and returns success', async () => {
    const record = JSON.stringify({
      success: true,
      referenceCode: 'BANK-REF-1',
      cardPan: '6037-99**-**-0000',
    });
    const { provider, getMock } = build(record);

    const out = await provider.verify({ providerReference: 'dev-abc', expectedAmount: 1_000n });

    expect(getMock).toHaveBeenCalledWith('dev:payment:dev-abc');
    expect(out.verified).toBe(true);
    expect(out.referenceCode).toBe('BANK-REF-1');
    expect(out.cardPan).toBe('6037-99**-**-0000');
  });

  it('verify returns verified=false when no record exists', async () => {
    const { provider } = build(null);
    const out = await provider.verify({ providerReference: 'dev-xyz', expectedAmount: 1_000n });
    expect(out.verified).toBe(false);
    expect(out.failureReason).toMatch(/has not paid yet/i);
  });

  it('verify returns verified=false when record signals failure', async () => {
    const { provider } = build(JSON.stringify({ success: false, failureReason: 'card declined' }));
    const out = await provider.verify({ providerReference: 'dev-xyz', expectedAmount: 1_000n });
    expect(out.verified).toBe(false);
    expect(out.failureReason).toBe('card declined');
  });

  it('verify returns verified=false on malformed JSON', async () => {
    const { provider } = build('not-json');
    const out = await provider.verify({ providerReference: 'dev-xyz', expectedAmount: 1_000n });
    expect(out.verified).toBe(false);
    expect(out.failureReason).toMatch(/malformed/i);
  });

  it('refund logs and returns refunded=true', async () => {
    const { provider } = build(null);
    const out = await provider.refund({
      providerReference: 'dev-1',
      amount: 100n,
      reason: 'test',
    });
    expect(out.refunded).toBe(true);
  });
});
