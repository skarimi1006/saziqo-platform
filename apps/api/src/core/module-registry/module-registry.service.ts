import { Injectable, Logger } from '@nestjs/common';

import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';

import type {
  AdminPageDefinition,
  NotificationTypeDefinition,
  PermissionDefinition,
  PlatformModule,
} from './types';

// CLAUDE: The registry is the single source of truth at runtime for which
// modules are loaded. register() is called by the Phase-11B loader for
// every entry in modules.config.ts. The four merge*() methods are
// idempotent so re-running them on subsequent boots (or in tests) does
// not produce duplicate rows or duplicate template registrations.

@Injectable()
export class ModuleRegistryService {
  private readonly logger = new Logger(ModuleRegistryService.name);
  private readonly modules = new Map<string, PlatformModule>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly payments: PaymentsService,
  ) {}

  register(module: PlatformModule): void {
    if (this.modules.has(module.name)) {
      throw new Error(`Module already registered: ${module.name}`);
    }
    this.modules.set(module.name, module);
  }

  getRegistered(): PlatformModule[] {
    return Array.from(this.modules.values());
  }

  getByName(name: string): PlatformModule | undefined {
    return this.modules.get(name);
  }

  getEnabledModules(): PlatformModule[] {
    return this.getRegistered().filter((m) => m.enabled);
  }

  // Idempotent: upserts every permission code, then ensures each
  // defaultRoles[] role gets a RolePermission link via createMany +
  // skipDuplicates. Roles missing from the `roles` table are skipped
  // with a warning — role seeding is owned by Phase 4D and the registry
  // never creates roles itself.
  async mergePermissions(): Promise<void> {
    const enabled = this.getEnabledModules();
    for (const module of enabled) {
      const definitions = module.registerPermissions();
      for (const def of definitions) {
        await this.upsertPermission(def);
      }
    }
  }

  private async upsertPermission(def: PermissionDefinition): Promise<void> {
    const permission = await this.prisma.permission.upsert({
      where: { code: def.code },
      create: { code: def.code, description: def.description },
      update: { description: def.description },
    });

    if (!def.defaultRoles || def.defaultRoles.length === 0) {
      return;
    }

    const roles = await this.prisma.role.findMany({
      where: { name: { in: [...def.defaultRoles] } },
      select: { id: true, name: true },
    });

    const missing = def.defaultRoles.filter((r) => !roles.some((row) => row.name === r));
    if (missing.length > 0) {
      this.logger.warn(
        `Permission ${def.code} references unseeded roles: ${missing.join(', ')} — link skipped`,
      );
    }

    if (roles.length === 0) return;

    await this.prisma.rolePermission.createMany({
      data: roles.map((role) => ({ roleId: role.id, permissionId: permission.id })),
      skipDuplicates: true,
    });
  }

  mergeNotificationTypes(): void {
    for (const module of this.getEnabledModules()) {
      const types = module.registerNotificationTypes?.() ?? [];
      for (const def of types) {
        this.notifications.registerType(def);
      }
    }
  }

  mergeAdminPages(): AdminPageDefinition[] {
    const pages: AdminPageDefinition[] = [];
    for (const module of this.getEnabledModules()) {
      const modulePages = module.registerAdminPages?.() ?? [];
      pages.push(...modulePages);
    }
    return pages.sort((a, b) => {
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.titleFa.localeCompare(b.titleFa, 'fa');
    });
  }

  mergePaymentPurposes(): string[] {
    const purposes: string[] = [];
    for (const module of this.getEnabledModules()) {
      const modulePurposes = module.registerPaymentPurposes?.() ?? [];
      purposes.push(...modulePurposes);
    }
    const unique = Array.from(new Set(purposes));
    this.payments.registerAllowedPurposes(unique);
    return unique;
  }

  // Convenience used by NotificationsService and others to verify a type
  // belongs to a registered module — currently exposed for tests.
  getNotificationTypeOwner(type: string): string | undefined {
    for (const module of this.getEnabledModules()) {
      const types = module.registerNotificationTypes?.() ?? [];
      if (types.some((t) => t.type === type)) return module.name;
    }
    return undefined;
  }
}

export type { PermissionDefinition, NotificationTypeDefinition, AdminPageDefinition };
