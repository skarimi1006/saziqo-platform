import { Injectable } from '@nestjs/common';

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
              permission: { code: permission },
            },
          },
        },
      },
    });
    return count > 0;
  }
}
