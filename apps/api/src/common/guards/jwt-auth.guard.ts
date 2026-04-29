import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { jwtVerify } from 'jose';

import { ConfigService } from '../../config/config.service';
import { ErrorCode } from '../types/response.types';

export interface AuthenticatedUser {
  id: bigint;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = this.extractToken(request);

    if (!token) {
      throw new HttpException(
        { code: ErrorCode.UNAUTHORIZED, message: 'Access token required' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const secret = new TextEncoder().encode(this.config.get('JWT_SECRET'));
    try {
      const { payload } = await jwtVerify(token, secret);
      if (!payload.sub) throw new Error('Missing sub claim');
      request.user = { id: BigInt(payload.sub) };
      return true;
    } catch {
      throw new HttpException(
        { code: ErrorCode.UNAUTHORIZED, message: 'Invalid or expired access token' },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private extractToken(request: Request): string | null {
    const auth = request.headers['authorization'];
    if (!auth || typeof auth !== 'string') return null;
    const spaceIdx = auth.indexOf(' ');
    if (spaceIdx === -1) return null;
    return auth.slice(0, spaceIdx) === 'Bearer' ? auth.slice(spaceIdx + 1) : null;
  }
}
