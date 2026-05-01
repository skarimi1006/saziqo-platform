export interface EmailProvider {
  name: string;
  send(input: EmailInput): Promise<EmailSendResult>;
}

export interface EmailInput {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  replyTo?: string;
}

export interface EmailSendResult {
  messageId: string;
}
