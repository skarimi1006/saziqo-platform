import { randomUUID } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';

import type { EmailInput, EmailProvider, EmailSendResult } from '../email-provider.interface';

@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  private readonly logger = new Logger(ConsoleEmailProvider.name);

  async send(input: EmailInput): Promise<EmailSendResult> {
    this.logger.log(`[EMAIL CONSOLE] To: ${input.to} Subject: ${input.subject}\n${input.textBody}`);
    return { messageId: `console-${randomUUID()}` };
  }
}
