import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

import { CORE_PERMISSIONS } from './permissions.catalog';

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedPermissions();
    await this.seedSuperAdminRole();
    await this.ensureSuperAdminUser();
    await this.seedMemberRole();
  }

  private async seedPermissions(): Promise<void> {
    for (const perm of CORE_PERMISSIONS) {
      await this.prisma.permission.upsert({
        where: { code: perm.code },
        create: { code: perm.code, description: perm.description },
        update: { description: perm.description },
      });
    }
    this.logger.log(`Seeded ${CORE_PERMISSIONS.length} core permissions`);
  }

  private async seedSuperAdminRole(): Promise<void> {
    const role = await this.prisma.role.upsert({
      where: { name: 'super_admin' },
      create: { name: 'super_admin', persianName: 'مدیر ارشد' },
      update: {},
    });

    const superPerm = await this.prisma.permission.findUnique({
      where: { code: 'super:everything' },
    });
    if (!superPerm) return;

    await this.prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: superPerm.id } },
      create: { roleId: role.id, permissionId: superPerm.id },
      update: {},
    });

    this.logger.log('Seeded super_admin role with super:everything permission');
  }

  private async ensureSuperAdminUser(): Promise<void> {
    const phone = this.config.get('SUPER_ADMIN_PHONE');
    if (!phone) return;

    let user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      user = await this.prisma.user.create({
        data: { phone, status: 'ACTIVE' },
      });
      this.logger.log(`Created super_admin user for ${phone}`);
    }

    const role = await this.prisma.role.findUnique({ where: { name: 'super_admin' } });
    if (!role) return;

    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });

    // Ensure ACTIVE status for the super_admin
    if (user.status !== 'ACTIVE') {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE' },
      });
    }

    this.logger.log(`Ensured super_admin role for ${phone}`);
  }

  private async seedMemberRole(): Promise<void> {
    const role = await this.prisma.role.upsert({
      where: { name: 'member' },
      create: { name: 'member', persianName: 'عضو' },
      update: {},
    });

    const memberPermCodes = ['users:read:profile_self', 'users:update:profile_self'];
    for (const code of memberPermCodes) {
      const perm = await this.prisma.permission.findUnique({ where: { code } });
      if (!perm) continue;
      await this.prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        create: { roleId: role.id, permissionId: perm.id },
        update: {},
      });
    }

    this.logger.log('Seeded member role with basic permissions');
  }
}
