import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PermissionsService } from '../../core/rbac/permissions.service';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { ErrorCode } from '../types/response.types';

import { AuthenticatedUser } from './jwt-auth.guard';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const userId = request.user?.id;

    if (!userId) {
      throw new HttpException(
        { code: ErrorCode.UNAUTHORIZED, message: 'Authentication required' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const hasPermission = await this.permissionsService.userHasPermission(userId, required);

    if (!hasPermission) {
      throw new HttpException(
        { code: ErrorCode.FORBIDDEN, message: 'Insufficient permissions' },
        HttpStatus.FORBIDDEN,
      );
    }

    return true;
  }
}
