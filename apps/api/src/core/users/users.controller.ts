import { Controller, Get, HttpException, HttpStatus, Param, UseGuards } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { z } from 'zod';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodQuery } from '../../common/decorators/zod-query.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ErrorCode } from '../../common/types/response.types';

import { UsersService } from './users.service';

const AdminListUsersSchema = z.object({
  status: z.nativeEnum(UserStatus).optional(),
  roleId: z.coerce.bigint().optional(),
  phoneContains: z.string().optional(),
  search: z.string().min(2).optional(),
  createdAfter: z.coerce.date().optional(),
  createdBefore: z.coerce.date().optional(),
  cursor: z.coerce.bigint().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
});

type AdminListUsersDto = z.infer<typeof AdminListUsersSchema>;

@Controller('admin/users')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission('admin:read:users')
  async listUsers(@ZodQuery(AdminListUsersSchema) query: AdminListUsersDto) {
    const { status, roleId, phoneContains, search, createdAfter, createdBefore, cursor, limit } =
      query;
    const result = await this.usersService.findManyForAdmin(
      { status, roleId, phoneContains, search, createdAfter, createdBefore },
      { cursor, limit },
    );
    return {
      data: result.items,
      meta: {
        pagination: {
          nextCursor: result.nextCursor?.toString() ?? undefined,
          limit,
        },
        hasMore: result.hasMore,
      },
    };
  }

  @Get(':id')
  @RequirePermission('admin:read:users')
  async getUser(@Param('id') id: string) {
    let userId: bigint;
    try {
      userId = BigInt(id);
    } catch {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'User not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    const user = await this.usersService.findByIdForAdmin(userId);
    if (!user) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'User not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return user;
  }
}
