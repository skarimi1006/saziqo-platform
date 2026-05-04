import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { Request } from 'express';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { ZodQuery } from '../../common/decorators/zod-query.decorator';
import { JwtAuthGuard, AuthenticatedUser } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ErrorCode } from '../../common/types/response.types';
import { AUDIT_ACTIONS } from '../audit/actions.catalog';
import { maskPhone } from '../audit/redaction';

import { UpdateUserSchema, UpdateUserDto } from './dto/update-user.dto';
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

const AssignRoleSchema = z
  .object({
    roleId: z.coerce.bigint(),
    scope: z.record(z.unknown()).optional(),
  })
  .strict();

type AssignRoleDto = z.infer<typeof AssignRoleSchema>;

type AuthRequest = Request & { user: AuthenticatedUser };

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

  @Get(':id/light')
  @RequirePermission('admin:read:users')
  async getUserLight(@Param('id') id: string) {
    const user = await this.usersService.findByIdForAdmin(this.parseId(id));
    if (!user) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'User not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneMasked: maskPhone(user.phone),
    };
  }

  @Get(':id')
  @RequirePermission('admin:read:users')
  async getUser(@Param('id') id: string) {
    const user = await this.usersService.findByIdForAdmin(this.parseId(id));
    if (!user) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'User not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return user;
  }

  @Patch(':id')
  @RequirePermission('admin:update:user')
  @Audit({ action: AUDIT_ACTIONS.ADMIN_USER_UPDATE, resource: 'user', resourceIdParam: 'id' })
  async updateUser(
    @Param('id') id: string,
    @ZodBody(UpdateUserSchema) body: UpdateUserDto,
    @Req() req: AuthRequest,
  ) {
    const userId = this.parseId(id);
    const actorId = req.user.id;

    if (body.status !== undefined) {
      await this.usersService.updateStatusByAdmin(userId, body.status, actorId);
    }

    // Profile-field updates (name, email) — phone is immutable in v1.
    const hasProfileUpdate =
      body.firstName !== undefined || body.lastName !== undefined || body.email !== undefined;
    if (hasProfileUpdate) {
      await this.usersService.update(userId, {
        ...(body.firstName !== undefined && { firstName: body.firstName }),
        ...(body.lastName !== undefined && { lastName: body.lastName }),
        ...(body.email !== undefined && { email: body.email }),
      });
    }

    const updated = await this.usersService.findByIdForAdmin(userId);
    if (!updated) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'User not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return updated;
  }

  @Post(':id/roles')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('admin:moderate:user')
  @Audit({ action: AUDIT_ACTIONS.ADMIN_ROLE_ASSIGNED, resource: 'user', resourceIdParam: 'id' })
  async assignRole(
    @Param('id') id: string,
    @ZodBody(AssignRoleSchema) body: AssignRoleDto,
    @Req() req: AuthRequest,
  ) {
    const userId = this.parseId(id);
    await this.usersService.assignRoleByAdmin(userId, body.roleId, body.scope, req.user.id);
    const updated = await this.usersService.findByIdForAdmin(userId);
    if (!updated) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'User not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return updated;
  }

  @Delete(':id/roles/:roleId')
  @RequirePermission('admin:moderate:user')
  @Audit({ action: AUDIT_ACTIONS.ADMIN_ROLE_REMOVED, resource: 'user', resourceIdParam: 'id' })
  async removeRole(
    @Param('id') id: string,
    @Param('roleId') roleId: string,
    @Req() req: AuthRequest,
  ) {
    const userId = this.parseId(id);
    const roleIdBigInt = this.parseId(roleId);
    await this.usersService.removeRoleByAdmin(userId, roleIdBigInt, req.user.id);
    const updated = await this.usersService.findByIdForAdmin(userId);
    if (!updated) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'User not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return updated;
  }

  private parseId(raw: string): bigint {
    try {
      return BigInt(raw);
    } catch {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'User not found' },
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
