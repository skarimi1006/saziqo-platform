import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ImpersonationSession } from '@prisma/client';

import { ErrorCode } from '../../common/types/response.types';
import { AUDIT_ACTIONS } from '../audit/actions.catalog';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { IssuedTokens, SessionsService } from '../sessions/sessions.service';

export interface StartImpersonationResult {
  impSessionId: bigint;
  tokens: IssuedTokens;
}

@Injectable()
export class ImpersonationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
  ) {}

  // SECURITY: Refusing to impersonate any super_admin prevents privilege
  // escalation via a compromised admin account, and is the only check
  // that distinguishes "support reaching into a user account" from
  // "an admin grabbing root." The role lookup runs before the
  // ImpersonationSession row is created.
  async start(
    actorUserId: bigint,
    targetUserId: bigint,
    reason: string,
    userAgent: string | null,
    ipAddress: string | null,
  ): Promise<StartImpersonationResult> {
    const targetIsSuperAdmin = await this.prisma.userRole.findFirst({
      where: { userId: targetUserId, role: { name: 'super_admin' } },
      select: { userId: true },
    });
    if (targetIsSuperAdmin) {
      throw new HttpException(
        {
          code: ErrorCode.CANNOT_IMPERSONATE_SUPER_ADMIN,
          message: 'Cannot impersonate a super_admin user',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    const created = await this.prisma.impersonationSession.create({
      data: {
        actorUserId,
        targetUserId,
        reason,
      },
    });

    const tokens = await this.sessions.issueImpersonationTokens(
      actorUserId,
      targetUserId,
      created.id,
      userAgent,
      ipAddress,
    );

    await this.audit.log({
      actorUserId,
      action: AUDIT_ACTIONS.IMPERSONATION_STARTED,
      resource: 'user',
      resourceId: targetUserId,
      payload: { reason },
      ipAddress,
      userAgent,
      impersonationSessionId: created.id,
    });

    return { impSessionId: created.id, tokens };
  }

  // The actor scope on the where clause is what enforces ownership: an admin
  // cannot stop someone else's impersonation by guessing the session id.
  async stop(impSessionId: bigint, actorUserId: bigint): Promise<ImpersonationSession> {
    const existing = await this.prisma.impersonationSession.findUnique({
      where: { id: impSessionId },
    });
    if (!existing || existing.actorUserId !== actorUserId) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Impersonation session not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    if (existing.endedAt !== null) {
      // Already ended — return idempotently. The audit row is permanent so
      // there is no harm in returning the same row twice.
      return existing;
    }

    const endedAt = new Date();
    const updated = await this.prisma.impersonationSession.update({
      where: { id: impSessionId },
      data: { endedAt },
    });

    const durationSeconds = Math.max(
      0,
      Math.floor((endedAt.getTime() - updated.startedAt.getTime()) / 1000),
    );

    await this.audit.log({
      actorUserId: updated.actorUserId,
      action: AUDIT_ACTIONS.IMPERSONATION_ENDED,
      resource: 'user',
      resourceId: updated.targetUserId,
      payload: {
        reason: updated.reason,
        durationSeconds,
      },
      ipAddress: null,
      userAgent: null,
      impersonationSessionId: updated.id,
    });

    return updated;
  }

  async findActive(actorUserId: bigint): Promise<ImpersonationSession | null> {
    return this.prisma.impersonationSession.findFirst({
      where: { actorUserId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
  }
}
