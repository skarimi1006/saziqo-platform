// CLAUDE: Single source of truth for system-level permission codes.
// Phase 4A's BootstrapService will upsert every entry on each API boot
// (idempotent) into the `permissions` table. Until that ships, controllers
// reference these codes via @RequirePermission and DBA seeds them by
// hand. Module-specific permissions live in the module's own catalog and
// are merged in at boot — never edit those entries from this file.
//
// Adding a code is cheap; renaming or removing one is a breaking change
// for every UserRole row that grants it. Treat the catalog as append-only.
export interface PermissionDefinition {
  readonly code: string;
  readonly description: string;
}

export const CORE_PERMISSIONS: readonly PermissionDefinition[] = [
  { code: 'users:read:profile_self', description: 'Read your own profile' },
  { code: 'users:update:profile_self', description: 'Update your own profile' },
  { code: 'admin:read:users', description: 'List and read user records' },
  { code: 'admin:update:user', description: 'Update user profile or status' },
  { code: 'admin:moderate:user', description: 'Assign or revoke roles on a user' },
  { code: 'admin:read:audit_log', description: 'Read the platform audit log' },
  { code: 'admin:impersonate:user', description: 'Start an impersonation session against a user' },
  { code: 'admin:read:any_file', description: 'Read any file regardless of ownership' },
  { code: 'admin:read:payouts', description: 'Read payout records' },
  { code: 'admin:approve:payout', description: 'Approve a pending payout' },
  { code: 'admin:manage:settings', description: 'Change platform-level settings' },
  { code: 'admin:manage:modules', description: 'Enable or disable business modules' },
  { code: 'admin:trigger:kill_switch', description: 'Trigger the platform kill switch' },
  { code: 'super:everything', description: 'super_admin only — implicitly grants every check' },
] as const;
