import { Logger } from '@nestjs/common';

import type {
  AdminPageDefinition,
  ModuleDeps,
  NotificationTypeDefinition,
  PermissionDefinition,
  PlatformModule,
} from '../../core/module-registry/types';

import { ExampleModule } from './example.module';

// CLAUDE: Reference module — do not remove. New module authors copy this skeleton.
// This is the PlatformModule instance for _example. The enabled flag is
// driven by ENABLE_EXAMPLE_MODULE env var, defaulting to true in non-production
// so developers can exercise the full module flow locally without extra config.
// In production, set ENABLE_EXAMPLE_MODULE=false (or omit the var) to ship dark.

const logger = new Logger('_example');

// Read at startup: true in dev unless explicitly set to 'false',
// false in production unless explicitly set to 'true'.
const enabled =
  process.env.ENABLE_EXAMPLE_MODULE !== undefined
    ? process.env.ENABLE_EXAMPLE_MODULE === 'true'
    : process.env.NODE_ENV !== 'production';

const exampleModule: PlatformModule = {
  name: '_example',
  persianName: 'مثال',
  version: '0.1.0',
  enabled,

  registerNestModule: () => ExampleModule,

  registerPermissions(): PermissionDefinition[] {
    return [
      {
        code: '_example:read:ping',
        description: 'Read example ping',
        persianDescription: 'خواندن پینگ مثال',
        defaultRoles: ['user', 'admin'],
      },
      {
        code: '_example:moderate',
        description: 'Moderate example',
        persianDescription: 'مدیریت مثال',
        defaultRoles: ['admin'],
      },
    ];
  },

  registerAuditActions(): Record<string, string> {
    return { EXAMPLE_PINGED: 'EXAMPLE_PINGED' };
  },

  registerNotificationTypes(): NotificationTypeDefinition[] {
    return [
      {
        type: '_EXAMPLE_TEST',
        inApp: {
          titleFa: 'تست مثال',
          bodyFa: (vars) => `پیام تست: ${String(vars['message'] ?? '')}`,
        },
      },
    ];
  },

  registerAdminPages(): AdminPageDefinition[] {
    return [
      {
        path: '/admin/_example',
        titleFa: 'مثال (توسعه)',
        icon: 'flask',
        permission: '_example:moderate',
        order: 999,
      },
    ];
  },

  registerPaymentPurposes(): string[] {
    return ['_example_topup'];
  },

  async onInstall(_deps: ModuleDeps): Promise<void> {
    logger.log('[_example] first install');
  },

  async onBoot(_deps: ModuleDeps): Promise<void> {
    logger.log('[_example] booted');
  },
};

export default exampleModule;
