import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { ConfigService } from '../../config/config.service';

import type { EmailInput, EmailProvider, EmailSendResult } from './email-provider.interface';
import { ConsoleEmailProvider } from './providers/console.provider';
import { SmtpEmailProvider } from './providers/smtp.provider';
import { EMAIL_TEMPLATES } from './templates.catalog';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  // Initialised in onModuleInit — guaranteed non-null after module start.
  private provider!: EmailProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly consoleProvider: ConsoleEmailProvider,
  ) {}

  onModuleInit(): void {
    const name = this.config.get('EMAIL_PROVIDER');
    if (name === 'console') {
      this.provider = this.consoleProvider;
      this.logger.log('Email provider: console (dev/test)');
    } else if (name === 'smtp') {
      // SmtpEmailProvider constructor always throws EMAIL_PROVIDER_NOT_CONFIGURED
      // until v1.5 implements the real adapter. This causes a hard startup
      // failure so the misconfiguration is caught immediately.
      this.provider = new SmtpEmailProvider();
    } else {
      throw new Error(`Unknown EMAIL_PROVIDER: ${String(name)}`);
    }
  }

  render(
    templateKey: string,
    vars: Record<string, unknown>,
  ): { subject: string; textBody: string } {
    const template = EMAIL_TEMPLATES[templateKey];
    if (!template) {
      throw new Error(`No email template for key: ${templateKey}`);
    }
    return {
      subject: template.subject,
      textBody: template.textBody(vars),
    };
  }

  async send(input: EmailInput): Promise<EmailSendResult> {
    return this.provider.send(input);
  }
}
