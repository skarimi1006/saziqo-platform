import { SetMetadata, applyDecorators } from '@nestjs/common';

import { RequirePermission } from './require-permission.decorator';

export const ADMIN_CONFIRM_HEADER_KEY = 'admin:confirmHeader';

export interface AdminOnlyOptions {
  // When true, the request must additionally carry `X-Admin-Confirm: true`
  // or the AdminConfirmGuard returns 412 ADMIN_CONFIRM_REQUIRED. Used as
  // S6 last-line-of-defense for destructive admin operations.
  confirmHeader?: boolean;
  // Override the permission code. Defaults to super:everything per Phase 4D.
  permission?: string;
}

// SECURITY: AdminOnly stacks RBAC permission + (optional) confirm header.
// Default permission is `super:everything`, the super_admin-only sentinel.
// Endpoints that need a finer-grained permission pass it explicitly.
export const AdminOnly = (options?: AdminOnlyOptions): MethodDecorator & ClassDecorator =>
  applyDecorators(
    RequirePermission(options?.permission ?? 'super:everything'),
    SetMetadata(ADMIN_CONFIRM_HEADER_KEY, options?.confirmHeader === true),
  );
