// CLAUDE: Real SMTP integration deferred to v1.5. Instantiating this class
// will always throw so that EmailService fails fast at startup when
// EMAIL_PROVIDER=smtp is set before the adapter is implemented.
import { ErrorCode } from '../../../common/types/response.types';
import type { EmailInput, EmailProvider, EmailSendResult } from '../email-provider.interface';

export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';

  constructor() {
    throw new Error(ErrorCode.EMAIL_PROVIDER_NOT_CONFIGURED);
  }

  // Never reached — constructor always throws. Required by the interface.
  async send(_input: EmailInput): Promise<EmailSendResult> {
    throw new Error(ErrorCode.EMAIL_PROVIDER_NOT_CONFIGURED);
  }
}
