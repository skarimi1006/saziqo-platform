import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async userHasPermission(userId: bigint, permission: string): Promise<boolean> {
    const count = await this.prisma.userRole.count({
      where: {
        userId,
        role: {
          rolePermissions: {
            some: {
              permission: { code: { in: [permission, 'super:everything'] } },
            },
          },
        },
      },
    });
    return count > 0;
  }

  async assignRoleToUser(
    userId: bigint,
    roleId: bigint,
    scope?: Record<string, unknown> | undefined,
  ): Promise<void> {
    // Upsert is idempotent — re-assigning an existing role updates the scope.
    const scopeValue = scope !== undefined ? (scope as Prisma.InputJsonValue) : undefined;
    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      create: {
        userId,
        roleId,
        ...(scopeValue !== undefined && { scope: scopeValue }),
      },
      update: {
        ...(scopeValue !== undefined && { scope: scopeValue }),
      },
    });
  }

  // deleteMany is intentionally idempotent — removing an absent role is a no-op.
  async removeRoleFromUser(userId: bigint, roleId: bigint): Promise<void> {
    await this.prisma.userRole.deleteMany({ where: { userId, roleId } });
  }

  async getUserPermissions(userId: bigint): Promise<string[]> {
    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: {
        role: {
          userRoles: { some: { userId } },
        },
      },
      select: { permission: { select: { code: true } } },
    });
    const codes = rolePermissions.map((rp) => rp.permission.code);
    return Array.from(new Set(codes));
  }
}
