import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';

import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { AdminConfirmGuard } from '../../common/guards/admin-confirm.guard';
import {
  AuthenticatedUser,
  ImpersonationContext,
  JwtAuthGuard,
} from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ErrorCode } from '../../common/types/response.types';

import { ImpersonationService } from './impersonation.service';

const StartImpersonationSchema = z
  .object({
    targetUserId: z.coerce.bigint(),
    // SECURITY: Reason is mandatory and >= 10 chars. This is the operational
    // accountability artifact — a one-character "x" or "test" is rejected at
    // the boundary so the audit trail is meaningful.
    reason: z.string().min(10).max(500),
  })
  .strict();

type StartImpersonationDto = z.infer<typeof StartImpersonationSchema>;

type AuthRequest = Request & {
  user: AuthenticatedUser;
  impersonation?: ImpersonationContext;
};

@Controller('admin/impersonation')
@UseGuards(JwtAuthGuard, PermissionGuard, AdminConfirmGuard)
export class ImpersonationController {
  constructor(private readonly impersonation: ImpersonationService) {}

  @Post('start')
  @HttpCode(HttpStatus.OK)
  @AdminOnly({ confirmHeader: true, permission: 'admin:impersonate:user' })
  @Idempotent()
  async start(
    @ZodBody(StartImpersonationSchema) body: StartImpersonationDto,
    @Req() req: AuthRequest,
  ) {
    if (req.impersonation) {
      throw new HttpException(
        {
          code: ErrorCode.CANNOT_NEST_IMPERSONATION,
          message: 'Cannot start a new impersonation while already impersonating',
        },
        HttpStatus.CONFLICT,
      );
    }

    const userAgent =
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    const ipAddress = typeof req.ip === 'string' ? req.ip : null;

    const { impSessionId, tokens } = await this.impersonation.start(
      req.user.id,
      body.targetUserId,
      body.reason,
      userAgent,
      ipAddress,
    );

    return {
      impSessionId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      targetUserId: body.targetUserId,
    };
  }

  @Post('stop')
  @HttpCode(HttpStatus.OK)
  async stop(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    if (!req.impersonation) {
      throw new HttpException(
        {
          code: ErrorCode.UNAUTHORIZED,
          message: 'No active impersonation on this token',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const stopped = await this.impersonation.stop(
      req.impersonation.impSessionId,
      req.impersonation.actorUserId,
    );
    res.status(HttpStatus.OK);
    return {
      impSessionId: stopped.id,
      endedAt: stopped.endedAt,
    };
  }

  @Get('active')
  @RequirePermission('admin:impersonate:user')
  async active(@Req() req: AuthRequest) {
    const session = await this.impersonation.findActive(req.user.id);
    if (!session) return { active: null };
    return {
      active: {
        impSessionId: session.id,
        targetUserId: session.targetUserId,
        startedAt: session.startedAt,
        reason: session.reason,
      },
    };
  }
}
