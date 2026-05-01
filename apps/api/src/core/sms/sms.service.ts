import { Injectable, Logger } from '@nestjs/common';

import { ConfigService } from '../../config/config.service';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  async send(phone: string, message: string): Promise<void> {
    const provider = this.config.get('SMS_PROVIDER');

    if (provider === 'console') {
      this.logger.log(`[SMS CONSOLE] To: ${phone}\n${message}`);
      return;
    }

    if (provider === 'kavenegar') {
      // TODO(phase-3F): implement Kavenegar HTTP API integration
      // CLAUDE: Real Kavenegar integration deferred; credentials not yet configured.
      // Set KAVENEGAR_API_KEY and KAVENEGAR_SENDER_LINE in env when ready.
      this.logger.warn(`[SMS KAVENEGAR] stub — To: ${phone} | ${message.slice(0, 40)}...`);
      return;
    }

    this.logger.error(`Unknown SMS_PROVIDER: ${String(provider)}`);
  }
}
