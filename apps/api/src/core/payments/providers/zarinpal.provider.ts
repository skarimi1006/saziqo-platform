import { Injectable, Logger } from '@nestjs/common';

import { ErrorCode } from '../../../common/types/response.types';
import { ConfigService } from '../../../config/config.service';
import type {
  InitiateInput,
  InitiateOutput,
  PaymentProvider,
  RefundInput,
  RefundOutput,
  VerifyInput,
  VerifyOutput,
} from '../payment-provider.interface';

// CLAUDE: ZarinPal v4 uses toman in newer documentation, but historically the
// gateway expected Rial. Our internal contract is always toman (BIGINT). If
// ZarinPal switches the wire format back to Rial, perform the conversion here
// in `toGatewayAmount` / `fromGatewayAmount` rather than leaking it upstream.
const ZARINPAL_REQUEST_URL = 'https://api.zarinpal.com/pg/v4/payment/request.json';
const ZARINPAL_VERIFY_URL = 'https://api.zarinpal.com/pg/v4/payment/verify.json';
const ZARINPAL_STARTPAY_BASE = 'https://www.zarinpal.com/pg/StartPay';

const RETRY_DELAY_MS = 500;

interface ZarinPalErrors {
  code?: number;
  message?: string;
  validations?: unknown;
}

interface ZarinPalRequestData {
  code?: number;
  message?: string;
  authority?: string;
  fee_type?: string;
  fee?: number;
}

interface ZarinPalVerifyData {
  code?: number;
  message?: string;
  ref_id?: number | string;
  card_pan?: string;
  card_hash?: string;
  fee_type?: string;
  fee?: number;
}

interface ZarinPalEnvelope<T> {
  data: T | [];
  errors: ZarinPalErrors | [];
}

@Injectable()
export class ZarinPalProvider implements PaymentProvider {
  readonly name = 'zarinpal';
  private readonly logger = new Logger(ZarinPalProvider.name);

  constructor(private readonly config: ConfigService) {}

  async initiate(input: InitiateInput): Promise<InitiateOutput> {
    const merchantId = this.requireMerchantId();

    const body = {
      merchant_id: merchantId,
      amount: this.toGatewayAmount(input.amount),
      description: input.description,
      callback_url: input.callbackUrl,
      metadata: {
        mobile: input.userMobile,
        email: input.userEmail,
        order_id: input.referenceId,
      },
    };

    const envelope = await this.postWithRetry<ZarinPalRequestData>(ZARINPAL_REQUEST_URL, body);
    const data = this.unwrapData(envelope);
    const errors = this.unwrapErrors(envelope);

    if (data?.code === 100 && data.authority) {
      return {
        providerReference: data.authority,
        redirectUrl: `${ZARINPAL_STARTPAY_BASE}/${data.authority}`,
      };
    }

    const message = data?.message ?? errors?.message ?? 'Unknown ZarinPal error';
    this.logger.error(
      `ZarinPal initiate failed (code=${String(data?.code ?? errors?.code)}): ${message}`,
    );
    throw new Error(
      `${ErrorCode.PAYMENT_INITIATION_FAILED}: ${message} (code=${String(
        data?.code ?? errors?.code ?? 'unknown',
      )})`,
    );
  }

  async verify(input: VerifyInput): Promise<VerifyOutput> {
    const merchantId = this.requireMerchantId();

    const body = {
      merchant_id: merchantId,
      amount: this.toGatewayAmount(input.expectedAmount),
      authority: input.providerReference,
    };

    const envelope = await this.postWithRetry<ZarinPalVerifyData>(ZARINPAL_VERIFY_URL, body);
    const data = this.unwrapData(envelope);
    const errors = this.unwrapErrors(envelope);

    // 100 = verified now, 101 = already verified — both are terminal success.
    if (data && (data.code === 100 || data.code === 101)) {
      const out: VerifyOutput = { verified: true };
      if (data.ref_id != null) out.referenceCode = String(data.ref_id);
      if (data.card_pan) out.cardPan = data.card_pan;
      return out;
    }

    return {
      verified: false,
      failureReason:
        data?.message ?? errors?.message ?? `ZarinPal returned code ${String(data?.code)}`,
    };
  }

  // SECURITY: ZarinPal does not expose an automated refund API to standard
  // merchants. Refunds for v1 are handled manually by ops; this method is a
  // tripwire so callers fall back to the manual-refund codepath in 10E.
  async refund(_input: RefundInput): Promise<RefundOutput> {
    throw new Error(ErrorCode.REFUND_NOT_SUPPORTED_BY_PROVIDER);
  }

  private requireMerchantId(): string {
    const merchantId = this.config.get('ZARINPAL_MERCHANT_ID');
    if (!merchantId) {
      throw new Error(`${ErrorCode.PAYMENT_INITIATION_FAILED}: ZARINPAL_MERCHANT_ID not set`);
    }
    return merchantId;
  }

  private toGatewayAmount(toman: bigint): number {
    // ZarinPal's JSON API caps amount at a 32-bit-ish integer in practice;
    // Number is fine for any realistic toman amount. Throw loudly if we ever
    // exceed safe integer range so the failure mode is obvious.
    if (toman > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`${ErrorCode.PAYMENT_INITIATION_FAILED}: amount exceeds safe integer range`);
    }
    return Number(toman);
  }

  private unwrapData<T>(envelope: ZarinPalEnvelope<T>): T | undefined {
    if (Array.isArray(envelope.data)) {
      return undefined;
    }
    return envelope.data;
  }

  private unwrapErrors(envelope: ZarinPalEnvelope<unknown>): ZarinPalErrors | undefined {
    if (Array.isArray(envelope.errors)) {
      return undefined;
    }
    return envelope.errors;
  }

  // Retry policy: one retry on HTTP 5xx with a 500ms delay. 4xx (e.g. bad
  // merchant_id) is a deterministic failure and is never retried.
  private async postWithRetry<T>(
    url: string,
    body: Record<string, unknown>,
  ): Promise<ZarinPalEnvelope<T>> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (err) {
        lastError = err;
        if (attempt === 0) {
          await this.sleep(RETRY_DELAY_MS);
          continue;
        }
        throw new Error(
          `${ErrorCode.PAYMENT_INITIATION_FAILED}: network error (${(err as Error).message})`,
        );
      }

      if (response.status >= 500 && response.status <= 599) {
        lastError = new Error(`HTTP ${response.status}`);
        if (attempt === 0) {
          await this.sleep(RETRY_DELAY_MS);
          continue;
        }
        throw new Error(`${ErrorCode.PAYMENT_INITIATION_FAILED}: gateway HTTP ${response.status}`);
      }

      const json = (await response.json()) as ZarinPalEnvelope<T>;
      return json;
    }

    throw new Error(
      `${ErrorCode.PAYMENT_INITIATION_FAILED}: unreachable retry exit (${String(lastError)})`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
