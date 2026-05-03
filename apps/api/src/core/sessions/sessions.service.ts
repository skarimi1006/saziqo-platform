import { createHash, randomBytes } from 'crypto';

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Session } from '@prisma/client';
import { SignJWT } from 'jose';
import ms from 'ms';
import { v4 as uuidv4 } from 'uuid';

import { ErrorCode } from '../../common/types/response.types';
import { ConfigService } from '../../config/config.service';
import { AUDIT_ACTIONS } from '../audit/actions.catalog';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/types.catalog';
import { PrismaService } from '../prisma/prisma.service';

export interface RefreshCookie {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: 'strict';
    path: string;
    maxAge: number;
  };
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshCookie: RefreshCookie;
  sessionId: bigint;
}

const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // SECURITY: Issues access + refresh pair. Refresh token is generated as
  // 64 random bytes (base64url), but only the sha256 hex hash is persisted.
  // The raw token returns to the client once and never lands in the DB or
  // any log line.
  async issueTokens(
    userId: bigint,
    userAgent: string | null,
    ipAddress: string | null,
  ): Promise<IssuedTokens> {
    const { raw, hash } = this.generateRefreshToken();
    const refreshTtlMs = this.refreshTtlMs();

    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: hash,
        userAgent,
        ipAddress,
        expiresAt: new Date(Date.now() + refreshTtlMs),
      },
    });

    const accessToken = await this.signAccessToken(userId);

    return {
      accessToken,
      refreshToken: raw,
      sessionId: session.id,
      refreshCookie: this.buildCookie(raw, refreshTtlMs),
    };
  }

  // SECURITY: Impersonation tokens look like ordinary tokens but carry an
  // `imp` claim binding them to (a) the actual admin who started this and
  // (b) the ImpersonationSession row. JwtAuthGuard re-validates the row on
  // every request, so stopping the impersonation invalidates every token
  // issued for it before its 30-day refresh expiry.
  async issueImpersonationTokens(
    actorUserId: bigint,
    targetUserId: bigint,
    impSessionId: bigint,
    userAgent: string | null,
    ipAddress: string | null,
  ): Promise<IssuedTokens> {
    const { raw, hash } = this.generateRefreshToken();
    const refreshTtlMs = this.refreshTtlMs();

    const session = await this.prisma.session.create({
      data: {
        userId: targetUserId,
        refreshTokenHash: hash,
        userAgent,
        ipAddress,
        expiresAt: new Date(Date.now() + refreshTtlMs),
      },
    });

    const accessToken = await this.signImpersonationAccessToken(
      targetUserId,
      actorUserId,
      impSessionId,
    );

    return {
      accessToken,
      refreshToken: raw,
      sessionId: session.id,
      refreshCookie: this.buildCookie(raw, refreshTtlMs),
    };
  }

  // Atomic rotation. The four-state branch lives inside one transaction:
  //   not found    → SESSION_INVALID
  //   already revoked → SESSION_REPLAY (and revoke ALL active sessions for the user)
  //   expired      → SESSION_EXPIRED (and revoke this session)
  //   valid        → revoke this session, create new, return new pair
  async rotateRefreshToken(currentRefreshToken: string): Promise<IssuedTokens> {
    const incomingHash = createHash('sha256').update(currentRefreshToken).digest('hex');

    return this.prisma.$transaction(async (tx) => {
      const session = await tx.session.findUnique({ where: { refreshTokenHash: incomingHash } });

      if (!session) {
        throw new HttpException(
          { code: ErrorCode.SESSION_INVALID, message: 'Refresh token is invalid' },
          HttpStatus.UNAUTHORIZED,
        );
      }

      if (session.revokedAt !== null) {
        // SECURITY: A previously-revoked token is being presented. Either the
        // user already rotated successfully (and an attacker stole the old
        // token) or the token leaked. Revoke every active session for this
        // user as defense in depth, and write an audit row via the outer
        // Prisma client so the row survives this transaction's rollback.
        await tx.session.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit.log({
          actorUserId: session.userId,
          action: AUDIT_ACTIONS.SESSION_REPLAY_DETECTED,
          resource: 'session',
          resourceId: session.id,
          payload: { presentedSessionId: String(session.id) },
          ipAddress: null,
          userAgent: null,
        });
        throw new HttpException(
          {
            code: ErrorCode.SESSION_REPLAY,
            message: 'Refresh token replay detected; all sessions for this user have been revoked',
          },
          HttpStatus.UNAUTHORIZED,
        );
      }

      if (session.expiresAt.getTime() < Date.now()) {
        await tx.session.update({
          where: { id: session.id },
          data: { revokedAt: new Date() },
        });
        throw new HttpException(
          { code: ErrorCode.SESSION_EXPIRED, message: 'Refresh token has expired' },
          HttpStatus.UNAUTHORIZED,
        );
      }

      // Valid path: revoke old, create new in same transaction.
      await tx.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });

      const { raw, hash } = this.generateRefreshToken();
      const refreshTtlMs = this.refreshTtlMs();
      const newSession = await tx.session.create({
        data: {
          userId: session.userId,
          refreshTokenHash: hash,
          userAgent: session.userAgent,
          ipAddress: session.ipAddress,
          expiresAt: new Date(Date.now() + refreshTtlMs),
        },
      });

      const accessToken = await this.signAccessToken(session.userId);

      return {
        accessToken,
        refreshToken: raw,
        sessionId: newSession.id,
        refreshCookie: this.buildCookie(raw, refreshTtlMs),
      };
    });
  }

  async revokeSession(sessionId: bigint): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  // Ownership-checked revocation for user-facing endpoints.
  // Dispatches SESSION_REVOKED IN_APP notification only for admin-initiated
  // revocations — user-initiated self-revocation does not notify.
  async revokeOne(
    sessionId: bigint,
    userId: bigint,
    opts: { adminInitiated?: boolean } = {},
  ): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { userId: true, userAgent: true },
    });
    if (!session || session.userId !== userId) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Session not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    if (opts.adminInitiated === true) {
      await this.notifications.dispatch({
        userId,
        type: NOTIFICATION_TYPES.SESSION_REVOKED,
        payload: { userAgent: session.userAgent ?? 'ناشناس' },
        channels: ['IN_APP'],
      });
    }
  }

  async revokeAllForUser(userId: bigint): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async revokeByRefreshToken(token: string): Promise<void> {
    const hash = createHash('sha256').update(token).digest('hex');
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async findActive(userId: bigint): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ──────── private helpers ────────

  private async signAccessToken(userId: bigint): Promise<string> {
    const secret = new TextEncoder().encode(this.config.get('JWT_SECRET'));
    return new SignJWT({ type: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(userId))
      .setJti(uuidv4())
      .setIssuedAt()
      .setExpirationTime(this.config.get('JWT_EXPIRES_IN'))
      .sign(secret);
  }

  private async signImpersonationAccessToken(
    targetUserId: bigint,
    actorUserId: bigint,
    impSessionId: bigint,
  ): Promise<string> {
    const secret = new TextEncoder().encode(this.config.get('JWT_SECRET'));
    return new SignJWT({
      type: 'access',
      imp: {
        actorUserId: String(actorUserId),
        impSessionId: String(impSessionId),
      },
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(targetUserId))
      .setJti(uuidv4())
      .setIssuedAt()
      .setExpirationTime(this.config.get('JWT_EXPIRES_IN'))
      .sign(secret);
  }

  private generateRefreshToken(): { raw: string; hash: string } {
    const raw = randomBytes(64).toString('base64url');
    const hash = createHash('sha256').update(raw).digest('hex');
    return { raw, hash };
  }

  private refreshTtlMs(): number {
    const value = ms(this.config.get('JWT_REFRESH_EXPIRES_IN') as ms.StringValue);
    if (typeof value !== 'number') {
      throw new Error(
        `Invalid JWT_REFRESH_EXPIRES_IN: ${this.config.get('JWT_REFRESH_EXPIRES_IN')}`,
      );
    }
    return value;
  }

  private buildCookie(value: string, maxAgeMs: number): RefreshCookie {
    return {
      name: REFRESH_COOKIE_NAME,
      value,
      options: {
        httpOnly: true,
        secure: this.config.isProduction,
        sameSite: 'strict',
        path: REFRESH_COOKIE_PATH,
        maxAge: maxAgeMs,
      },
    };
  }
}
