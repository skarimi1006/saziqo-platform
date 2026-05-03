import {
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { AuthenticatedUser, JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ErrorCode } from '../../common/types/response.types';
import { SessionsService } from '../sessions/sessions.service';

import { CompleteProfileDto, CompleteProfileSchema } from './dto/complete-profile.dto';
import { UsersService } from './users.service';

type AuthRequest = Request & { user: AuthenticatedUser };

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ProfileController {
  constructor(
    private readonly usersService: UsersService,
    private readonly sessionsService: SessionsService,
  ) {}

  @Get('me')
  @RequirePermission('users:read:profile_self')
  async getMe(@Req() req: AuthRequest) {
    const user = await this.usersService.findForSelf(req.user.id);
    if (!user) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'User not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return user;
  }

  @Post('me/complete-profile')
  @RequirePermission('users:update:profile_self')
  async completeProfile(
    @Req() req: AuthRequest,
    @ZodBody(CompleteProfileSchema) body: CompleteProfileDto,
  ) {
    return this.usersService.completeProfile(req.user.id, body);
  }

  @Get('me/sessions')
  @RequirePermission('users:read:profile_self')
  async getSessions(@Req() req: AuthRequest) {
    const sessions = await this.sessionsService.findActive(req.user.id);
    return sessions.map((s) => ({
      id: s.id.toString(),
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    }));
  }

  @Delete('me/sessions/:id')
  @RequirePermission('users:read:profile_self')
  async revokeSession(@Param('id') id: string, @Req() req: AuthRequest) {
    await this.sessionsService.revokeOne(BigInt(id), req.user.id);
    return {};
  }

  @Delete('me/sessions')
  @RequirePermission('users:read:profile_self')
  async revokeAllSessions(@Req() req: AuthRequest) {
    await this.sessionsService.revokeAllForUser(req.user.id);
    return {};
  }
}
