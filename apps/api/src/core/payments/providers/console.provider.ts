import { randomUUID } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';

import { ConfigService } from '../../../config/config.service';
import { RedisService } from '../../redis/redis.service';
import type {
  InitiateInput,
  InitiateOutput,
  PaymentProvider,
  RefundInput,
  RefundOutput,
  VerifyInput,
  VerifyOutput,
} from '../payment-provider.interface';

// CLAUDE: Dev/test adapter. The "user" pays via a frontend simulator page
// that writes a JSON blob to Redis at `dev:payment:{referenceId}`; verify
// reads that blob back. Console provider is the default for local development
// and CI so test suites do not depend on ZarinPal availability.
const DEV_SIMULATOR_REDIS_PREFIX = 'dev:payment:';

interface DevPaymentRecord {
  success: boolean;
  referenceCode?: string;
  cardPan?: string;
  failureReason?: string;
}

@Injectable()
export class ConsolePaymentProvider implements PaymentProvider {
  readonly name = 'console';
  private readonly logger = new Logger(ConsolePaymentProvider.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async initiate(input: InitiateInput): Promise<InitiateOutput> {
    const providerReference = `dev-${randomUUID()}`;
    const webPort = this.config.get('PORT_WEB');
    const redirectUrl = `http://localhost:${webPort}/_dev/payment-simulator?ref=${encodeURIComponent(
      input.referenceId,
    )}&authority=${providerReference}`;

    this.logger.log(
      `[PAYMENT CONSOLE] initiate ref=${input.referenceId} amount=${input.amount.toString()} → ${redirectUrl}`,
    );

    return { providerReference, redirectUrl };
  }

  async verify(input: VerifyInput): Promise<VerifyOutput> {
    // The simulator page writes the outcome under the original referenceId
    // (which is also embedded in providerReference upstream by the service);
    // for the dev provider we look it up by providerReference, which the
    // simulator URL exposes back via `?ref=` and the test/dev UI mirrors.
    const key = `${DEV_SIMULATOR_REDIS_PREFIX}${input.providerReference}`;
    const raw = await this.redis.getClient().get(key);

    if (!raw) {
      return {
        verified: false,
        failureReason: 'No simulator record found in Redis (user has not paid yet)',
      };
    }

    let record: DevPaymentRecord;
    try {
      record = JSON.parse(raw) as DevPaymentRecord;
    } catch {
      return {
        verified: false,
        failureReason: 'Malformed simulator record in Redis',
      };
    }

    if (record.success) {
      return {
        verified: true,
        referenceCode: record.referenceCode ?? `console-${randomUUID()}`,
        cardPan: record.cardPan ?? '****-****-****-0000',
      };
    }

    return {
      verified: false,
      failureReason: record.failureReason ?? 'Simulated failure',
    };
  }

  async refund(input: RefundInput): Promise<RefundOutput> {
    this.logger.log(
      `[PAYMENT CONSOLE] refund ref=${input.providerReference} amount=${input.amount.toString()} reason=${input.reason}`,
    );
    return { refunded: true };
  }
}
