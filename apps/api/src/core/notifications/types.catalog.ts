export const NOTIFICATION_TYPES = {
  OTP_SENT: 'OTP_SENT', // SMS only — never stored as IN_APP row
  PROFILE_COMPLETED: 'PROFILE_COMPLETED', // IN_APP
  SESSION_REVOKED: 'SESSION_REVOKED', // IN_APP
  IMPERSONATION_NOTICE: 'IMPERSONATION_NOTICE', // IN_APP — notified after admin session ends
  PAYMENT_SUCCEEDED: 'PAYMENT_SUCCEEDED', // IN_APP + SMS
  PAYMENT_FAILED: 'PAYMENT_FAILED', // IN_APP
  PAYMENT_CANCELLED: 'PAYMENT_CANCELLED', // IN_APP — user cancelled at the gateway
  WALLET_CREDITED: 'WALLET_CREDITED', // IN_APP
  WALLET_DEBITED: 'WALLET_DEBITED', // IN_APP
  PAYOUT_REQUESTED: 'PAYOUT_REQUESTED', // IN_APP — admin sees
  PAYOUT_APPROVED: 'PAYOUT_APPROVED', // IN_APP — user sees
  PAYOUT_REJECTED: 'PAYOUT_REJECTED', // IN_APP — user sees
  PAYOUT_PAID: 'PAYOUT_PAID', // IN_APP — user sees after ops marks as paid
  // Module-specific types registered via ModuleContract.registerNotificationTemplates()
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

// OTP is the only type that MUST NOT persist as an IN_APP notification —
// the payload contains the one-time code.
export const NON_PERSISTENT_TYPES: ReadonlySet<string> = new Set([NOTIFICATION_TYPES.OTP_SENT]);
