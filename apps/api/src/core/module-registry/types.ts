import type { Logger, Type } from '@nestjs/common';

import { ConfigService } from '../../config/config.service';
import type { AuditService } from '../audit/audit.service';
import type { FileStore } from '../files/file-store.interface';
import type { LedgerService } from '../ledger/ledger.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PaymentsService } from '../payments/payments.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';

// CLAUDE: Canonical module contract. Every business module (agents,
// builders, templates, …) implements PlatformModule and is listed in
// modules.config.ts. The registry discovers, merges metadata, and the
// loader (Phase 11B) calls lifecycle hooks at boot. Breaking changes to
// this interface require a coordinated module version bump.

export interface PermissionDefinition {
  readonly code: string; // 'agents:create:listing'
  readonly description: string;
  readonly persianDescription: string;
  readonly defaultRoles?: readonly string[];
}

export interface NotificationTypeDefinition {
  readonly type: string;
  readonly inApp?: {
    readonly titleFa: string;
    readonly bodyFa: (vars: Record<string, unknown>) => string;
  };
  readonly sms?: (vars: Record<string, unknown>) => string;
  readonly email?: {
    readonly subject: string;
    readonly textBody: (vars: Record<string, unknown>) => string;
  };
}

export interface AdminPageDefinition {
  readonly path: string; // '/admin/agents/listings'
  readonly titleFa: string;
  readonly icon?: string;
  readonly permission: string; // 'agents:moderate:listing'
  readonly order?: number;
}

export interface ModuleDeps {
  readonly prisma: PrismaService;
  readonly redis: RedisService;
  readonly fileStore: FileStore;
  readonly ledger: LedgerService;
  readonly payments: PaymentsService;
  readonly notifications: NotificationsService;
  readonly audit: AuditService;
  readonly config: ConfigService;
  readonly logger: Logger;
}

export interface PlatformModule {
  readonly name: string;
  readonly persianName: string;
  readonly version: string;
  readonly enabled: boolean;

  registerNestModule(): Type<unknown>;
  registerPermissions(): readonly PermissionDefinition[];
  registerAuditActions(): Readonly<Record<string, string>>;
  registerNotificationTypes?(): readonly NotificationTypeDefinition[];
  registerAdminPages?(): readonly AdminPageDefinition[];
  registerPaymentPurposes?(): readonly string[];

  onInstall?(deps: ModuleDeps): Promise<void>;
  onBoot?(deps: ModuleDeps): Promise<void>;
  onShutdown?(deps: ModuleDeps): Promise<void>;
}
