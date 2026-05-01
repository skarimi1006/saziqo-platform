// SECURITY: Action codes are part of the audit contract. Adding a new
// code is allowed; renaming or removing one breaks downstream queries and
// dashboards. Keep the catalog in sync with the dashboards in docs/.
export const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  SIGNUP_SUCCESS: 'SIGNUP_SUCCESS',
  // AUTH_OTP_VERIFY is the declarative-decorator action for /auth/otp/verify;
  // the payload's `justCreated` discriminator distinguishes signup vs login
  // when readers prefer the one-row-per-attempt convention.
  AUTH_OTP_VERIFY: 'AUTH_OTP_VERIFY',
  SESSION_REFRESHED: 'SESSION_REFRESHED',
  LOGOUT: 'LOGOUT',
  PROFILE_COMPLETED: 'PROFILE_COMPLETED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  SESSION_REPLAY_DETECTED: 'SESSION_REPLAY_DETECTED',
  ADMIN_USER_UPDATE: 'ADMIN_USER_UPDATE',
  ADMIN_USER_STATUS_CHANGED: 'ADMIN_USER_STATUS_CHANGED',
  ADMIN_ROLE_ASSIGNED: 'ADMIN_ROLE_ASSIGNED',
  ADMIN_ROLE_REMOVED: 'ADMIN_ROLE_REMOVED',
  IMPERSONATION_STARTED: 'IMPERSONATION_STARTED',
  IMPERSONATION_ENDED: 'IMPERSONATION_ENDED',
  PERMISSION_GRANTED: 'PERMISSION_GRANTED',
  PERMISSION_REVOKED: 'PERMISSION_REVOKED',
  MAINTENANCE_TOGGLED: 'MAINTENANCE_TOGGLED',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
