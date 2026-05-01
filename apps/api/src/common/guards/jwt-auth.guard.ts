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
import { PrismaService } from '../../core/prisma/prisma.service';
import { ErrorCode } from '../types/response.types';

export interface AuthenticatedUser {
  id: bigint;
}

export interface ImpersonationContext {
  actorUserId: bigint;
  impSessionId: bigint;
}

interface RawImpClaim {
  actorUserId?: unknown;
  impSessionId?: unknown;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser; impersonation?: ImpersonationContext }>();
    const token = this.extractToken(request);

    if (!token) {
      throw new HttpException(
        { code: ErrorCode.UNAUTHORIZED, message: 'Access token required' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const secret = new TextEncoder().encode(this.config.get('JWT_SECRET'));
    let payloadSub: string;
    let rawImp: RawImpClaim | undefined;
    try {
      const { payload } = await jwtVerify(token, secret);
      if (!payload.sub) throw new Error('Missing sub claim');
      payloadSub = payload.sub;
      rawImp = payload['imp'] as RawImpClaim | undefined;
    } catch {
      throw new HttpException(
        { code: ErrorCode.UNAUTHORIZED, message: 'Invalid or expired access token' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    request.user = { id: BigInt(payloadSub) };

    if (rawImp !== undefined) {
      const impersonation = this.parseImpClaim(rawImp);
      // SECURITY: An ended ImpersonationSession must invalidate every token
      // issued for it, even before the 30-day refresh expiry. Re-check on
      // every request — caching this would defeat the kill-switch.
      const row = await this.prisma.impersonationSession.findUnique({
        where: { id: impersonation.impSessionId },
        select: { endedAt: true, actorUserId: true, targetUserId: true },
      });
      if (
        !row ||
        row.endedAt !== null ||
        row.actorUserId !== impersonation.actorUserId ||
        row.targetUserId !== request.user.id
      ) {
        throw new HttpException(
          {
            code: ErrorCode.IMPERSONATION_ENDED,
            message: 'Impersonation session is no longer active',
          },
          HttpStatus.UNAUTHORIZED,
        );
      }
      request.impersonation = impersonation;
    }

    return true;
  }

  private parseImpClaim(raw: RawImpClaim): ImpersonationContext {
    if (typeof raw.actorUserId !== 'string' || typeof raw.impSessionId !== 'string') {
      throw new HttpException(
        { code: ErrorCode.UNAUTHORIZED, message: 'Invalid impersonation claim' },
        HttpStatus.UNAUTHORIZED,
      );
    }
    try {
      return {
        actorUserId: BigInt(raw.actorUserId),
        impSessionId: BigInt(raw.impSessionId),
      };
    } catch {
      throw new HttpException(
        { code: ErrorCode.UNAUTHORIZED, message: 'Invalid impersonation claim' },
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
