import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { ADMIN_CONFIRM_HEADER_KEY } from '../decorators/admin-only.decorator';
import { ErrorCode } from '../types/response.types';

@Injectable()
export class AdminConfirmGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      ADMIN_CONFIRM_HEADER_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-admin-confirm'];
    if (typeof header !== 'string' || header !== 'true') {
      throw new HttpException(
        {
          code: ErrorCode.ADMIN_CONFIRM_REQUIRED,
          message: 'X-Admin-Confirm: true header required for this destructive operation',
        },
        HttpStatus.PRECONDITION_FAILED,
      );
    }
    return true;
  }
}
