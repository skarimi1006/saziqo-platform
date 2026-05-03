import { Controller, Get, UseGuards } from '@nestjs/common';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';

import { ModuleRegistryService } from './module-registry.service';
import type { AdminPageDefinition } from './types';

@Controller('admin/registry')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AdminRegistryController {
  constructor(private readonly registry: ModuleRegistryService) {}

  @Get('admin-pages')
  @RequirePermission('admin:read:users')
  getAdminPages(): AdminPageDefinition[] {
    return this.registry.mergeAdminPages();
  }
}
