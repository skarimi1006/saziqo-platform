// CLAUDE: Phase 8B will replace this stub with a full console + SMTP adapter
// pattern. For Phase 8A we only need a working send() so NotificationsService
// can compile and call it for the EMAIL channel.
import { Injectable, Logger } from '@nestjs/common';

import type { EmailInput, EmailSendResult } from './email-provider.interface';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async send(input: EmailInput): Promise<EmailSendResult> {
    this.logger.log(`[EMAIL CONSOLE] To: ${input.to} Subject: ${input.subject}\n${input.textBody}`);
    return { messageId: `console-placeholder` };
  }
}
