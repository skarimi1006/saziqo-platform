// CLAUDE: Full email abstraction built in Phase 8B. This file defines the
// shared interface so NotificationsModule can depend on EmailService without
// waiting for the real SMTP adapter.

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
