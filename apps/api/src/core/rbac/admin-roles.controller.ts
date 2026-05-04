import { Controller, Get, UseGuards } from '@nestjs/common';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('admin/roles')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AdminRolesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('admin:read:users')
  async listRoles() {
    const roles = await this.prisma.role.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        persianName: true,
        isSystem: true,
      },
    });
    return roles.map((r) => ({
      id: r.id.toString(),
      name: r.name,
      persianName: r.persianName,
      isSystem: r.isSystem,
    }));
  }
}
