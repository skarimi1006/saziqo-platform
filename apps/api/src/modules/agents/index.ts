import { Logger } from '@nestjs/common';

import type {
  AdminPageDefinition,
  ModuleDeps,
  NotificationTypeDefinition,
  PermissionDefinition,
  PlatformModule,
} from '../../core/module-registry/types';

import { AgentsModule } from './agents.module';
import { AGENTS_MODULE_NAME, AGENTS_MODULE_PERSIAN_NAME, AGENTS_MODULE_VERSION } from './constants';
import {
  AGENTS_ADMIN_PAGES,
  AGENTS_AUDIT_ACTIONS,
  AGENTS_NOTIFICATION_TYPES,
  AGENTS_PAYMENT_PURPOSES,
  AGENTS_PERMISSIONS,
} from './contract';

// CLAUDE: PlatformModule instance for the agents marketplace. Identity and
// metadata-registration callbacks live here; the NestJS @Module shell with
// controllers/providers lands in Phase 2A onward. Boot-loader expectations:
//   - module-loader.service.ts logs "[module-loader] registered agents v0.1.0"
//   - this file's onBoot logs "[agents] booted"
// Disabling the module via ENABLE_AGENTS_MODULE=false ships dark — the
// NestJS class is filtered out of AppModule's imports AND the loader
// skips lifecycle hooks (see modules.config.ts CLAUDE).

const logger = new Logger(AGENTS_MODULE_NAME);

// Read once at process start. Mirrors the _example pattern: explicit env
// value wins; otherwise default true in non-production so devs exercise
// the full flow without extra config and false in production until
// explicitly opted in.
const enabled =
  process.env.ENABLE_AGENTS_MODULE !== undefined
    ? process.env.ENABLE_AGENTS_MODULE === 'true'
    : process.env.NODE_ENV !== 'production';

const agentsModule: PlatformModule = {
  name: AGENTS_MODULE_NAME,
  persianName: AGENTS_MODULE_PERSIAN_NAME,
  version: AGENTS_MODULE_VERSION,
  enabled,

  registerNestModule: () => AgentsModule,

  registerPermissions(): readonly PermissionDefinition[] {
    return AGENTS_PERMISSIONS;
  },

  registerAuditActions(): Readonly<Record<string, string>> {
    return AGENTS_AUDIT_ACTIONS;
  },

  registerNotificationTypes(): readonly NotificationTypeDefinition[] {
    return AGENTS_NOTIFICATION_TYPES;
  },

  registerAdminPages(): readonly AdminPageDefinition[] {
    return AGENTS_ADMIN_PAGES;
  },

  registerPaymentPurposes(): readonly string[] {
    return AGENTS_PAYMENT_PURPOSES;
  },

  async onInstall(_deps: ModuleDeps): Promise<void> {
    logger.log('[agents] first install');
  },

  async onBoot(_deps: ModuleDeps): Promise<void> {
    logger.log('[agents] booted');
  },
};

export default agentsModule;
