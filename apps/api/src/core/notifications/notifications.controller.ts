import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodQuery } from '../../common/decorators/zod-query.decorator';
import { JwtAuthGuard, AuthenticatedUser } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ErrorCode } from '../../common/types/response.types';
import { AUDIT_ACTIONS } from '../audit/actions.catalog';

import { NotificationsService } from './notifications.service';

const ListNotificationsSchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('false'),
  cursor: z.coerce.bigint().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
});

type ListNotificationsDto = z.infer<typeof ListNotificationsSchema>;

type AuthRequest = Request & { user: AuthenticatedUser };

@Controller('users/me/notifications')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @RequirePermission('users:read:profile_self')
  async list(
    @ZodQuery(ListNotificationsSchema) query: ListNotificationsDto,
    @Req() req: AuthRequest,
  ) {
    const userId = req.user.id;
    const pagination = {
      limit: query.limit,
      ...(query.cursor !== undefined && { cursor: query.cursor }),
    };

    const page = query.unreadOnly
      ? await this.notificationsService.findUnreadForUser(userId, pagination)
      : await this.notificationsService.findAllForUser(userId, pagination);

    const items = page.items.map((n) => this.notificationsService.renderForUser(n));

    return {
      data: items,
      meta: {
        pagination: {
          nextCursor: page.nextCursor?.toString() ?? undefined,
          limit: query.limit,
        },
        hasMore: page.hasMore,
      },
    };
  }

  @Get('count-unread')
  @RequirePermission('users:read:profile_self')
  async countUnread(@Req() req: AuthRequest) {
    const count = await this.notificationsService.countUnread(req.user.id);
    return { count };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('users:read:profile_self')
  @Audit({
    action: AUDIT_ACTIONS.NOTIFICATION_MARKED_READ,
    resource: 'notification',
    resourceIdParam: 'id',
  })
  async markRead(@Param('id') id: string, @Req() req: AuthRequest) {
    await this.notificationsService.markRead(this.parseId(id), req.user.id);
    return {};
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('users:read:profile_self')
  async markAllRead(@Req() req: AuthRequest) {
    await this.notificationsService.markAllRead(req.user.id);
    return {};
  }

  private parseId(raw: string): bigint {
    try {
      return BigInt(raw);
    } catch {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Notification not found' },
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
