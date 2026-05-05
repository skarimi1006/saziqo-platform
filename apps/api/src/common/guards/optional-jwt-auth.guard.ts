import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { jwtVerify } from 'jose';

import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../../core/prisma/prisma.service';

import { type AuthenticatedUser, type ImpersonationContext } from './jwt-auth.guard';

interface RawImpClaim {
  actorUserId?: unknown;
  impSessionId?: unknown;
}

// CLAUDE: Soft variant of JwtAuthGuard for endpoints that are public but
// want to enrich the response when the caller happens to be logged in
// (e.g. ownership flag on the public listing detail page). Any failure —
// missing header, malformed token, expired signature, ended impersonation
// session — degrades silently to anonymous; the route still serves a 200.
// Strict authentication uses JwtAuthGuard.
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser; impersonation?: ImpersonationContext }>();
    const token = this.extractToken(request);
    if (!token) return true;

    const secret = new TextEncoder().encode(this.config.get('JWT_SECRET'));
    try {
      const { payload } = await jwtVerify(token, secret);
      if (typeof payload.sub !== 'string') return true;
      const userId = BigInt(payload.sub);

      const rawImp = payload['imp'] as RawImpClaim | undefined;
      if (rawImp !== undefined) {
        if (typeof rawImp.actorUserId !== 'string' || typeof rawImp.impSessionId !== 'string') {
          return true;
        }
        const actorUserId = BigInt(rawImp.actorUserId);
        const impSessionId = BigInt(rawImp.impSessionId);
        // SECURITY: an ended impersonation session must invalidate every
        // token issued for it, even on public routes.
        const row = await this.prisma.impersonationSession.findUnique({
          where: { id: impSessionId },
          select: { endedAt: true, actorUserId: true, targetUserId: true },
        });
        if (
          !row ||
          row.endedAt !== null ||
          row.actorUserId !== actorUserId ||
          row.targetUserId !== userId
        ) {
          return true;
        }
        request.impersonation = { actorUserId, impSessionId };
      }

      request.user = { id: userId };
    } catch {
      // Verification failed — continue anonymously.
    }
    return true;
  }

  private extractToken(request: Request): string | null {
    const auth = request.headers['authorization'];
    if (!auth || typeof auth !== 'string') return null;
    const spaceIdx = auth.indexOf(' ');
    if (spaceIdx === -1) return null;
    return auth.slice(0, spaceIdx) === 'Bearer' ? auth.slice(spaceIdx + 1) : null;
  }
}
