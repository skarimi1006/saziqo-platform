import '../../common/bigint-serialization';

import { HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ErrorCode } from '../../common/types/response.types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';

import { ImpersonationService } from './impersonation.service';

interface MockPrisma {
  userRole: { findFirst: jest.Mock };
  impersonationSession: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
}

describe('ImpersonationService', () => {
  let service: ImpersonationService;
  let prisma: MockPrisma;
  let sessions: { issueImpersonationTokens: jest.Mock };
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = {
      userRole: { findFirst: jest.fn() },
      impersonationSession: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    sessions = { issueImpersonationTokens: jest.fn() };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ImpersonationService,
        { provide: PrismaService, useValue: prisma },
        { provide: SessionsService, useValue: sessions },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(ImpersonationService);
  });

  describe('start', () => {
    it('rejects impersonating a super_admin with 403 CANNOT_IMPERSONATE_SUPER_ADMIN', async () => {
      prisma.userRole.findFirst.mockResolvedValue({ userId: 5n });

      await expect(service.start(1n, 5n, 'support ticket #999', null, null)).rejects.toMatchObject({
        response: { code: ErrorCode.CANNOT_IMPERSONATE_SUPER_ADMIN },
        status: HttpStatus.FORBIDDEN,
      });

      expect(prisma.impersonationSession.create).not.toHaveBeenCalled();
      expect(sessions.issueImpersonationTokens).not.toHaveBeenCalled();
    });

    it('creates a session row and issues impersonation tokens for non-super_admin targets', async () => {
      prisma.userRole.findFirst.mockResolvedValue(null);
      prisma.impersonationSession.create.mockResolvedValue({
        id: 42n,
        actorUserId: 1n,
        targetUserId: 5n,
        reason: 'investigating support ticket',
        startedAt: new Date(),
        endedAt: null,
      });
      sessions.issueImpersonationTokens.mockResolvedValue({
        accessToken: 'imp.access',
        refreshToken: 'imp.refresh',
        sessionId: 99n,
        refreshCookie: { name: 'refresh_token', value: 'x', options: {} },
      });

      const result = await service.start(
        1n,
        5n,
        'investigating support ticket',
        'curl/8',
        '127.0.0.1',
      );

      expect(prisma.userRole.findFirst).toHaveBeenCalledWith({
        where: { userId: 5n, role: { name: 'super_admin' } },
        select: { userId: true },
      });
      expect(prisma.impersonationSession.create).toHaveBeenCalledWith({
        data: {
          actorUserId: 1n,
          targetUserId: 5n,
          reason: 'investigating support ticket',
        },
      });
      expect(sessions.issueImpersonationTokens).toHaveBeenCalledWith(
        1n,
        5n,
        42n,
        'curl/8',
        '127.0.0.1',
      );
      expect(result.impSessionId).toBe(42n);
      expect(result.tokens.accessToken).toBe('imp.access');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'IMPERSONATION_STARTED',
          actorUserId: 1n,
          resource: 'user',
          resourceId: 5n,
          payload: { reason: 'investigating support ticket' },
          impersonationSessionId: 42n,
        }),
      );
    });
  });

  describe('stop', () => {
    it('returns NOT_FOUND when the session does not belong to the actor', async () => {
      prisma.impersonationSession.findUnique.mockResolvedValue({
        id: 42n,
        actorUserId: 99n,
        endedAt: null,
        startedAt: new Date(),
      });

      await expect(service.stop(42n, 1n)).rejects.toMatchObject({
        response: { code: ErrorCode.NOT_FOUND },
        status: HttpStatus.NOT_FOUND,
      });
      expect(prisma.impersonationSession.update).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND for an unknown session id', async () => {
      prisma.impersonationSession.findUnique.mockResolvedValue(null);
      await expect(service.stop(42n, 1n)).rejects.toMatchObject({
        response: { code: ErrorCode.NOT_FOUND },
      });
    });

    it('is idempotent when the session is already ended', async () => {
      const ended = {
        id: 42n,
        actorUserId: 1n,
        endedAt: new Date('2026-01-01'),
        startedAt: new Date('2026-01-01'),
      };
      prisma.impersonationSession.findUnique.mockResolvedValue(ended);

      const result = await service.stop(42n, 1n);
      expect(result).toBe(ended);
      expect(prisma.impersonationSession.update).not.toHaveBeenCalled();
    });

    it('stamps endedAt for an active session owned by the actor', async () => {
      const startedAt = new Date(Date.now() - 60_000);
      prisma.impersonationSession.findUnique.mockResolvedValue({
        id: 42n,
        actorUserId: 1n,
        targetUserId: 5n,
        endedAt: null,
        startedAt,
        reason: 'support',
      });
      prisma.impersonationSession.update.mockImplementation(async ({ data }) => ({
        id: 42n,
        actorUserId: 1n,
        targetUserId: 5n,
        endedAt: data.endedAt,
        startedAt,
        reason: 'support',
      }));

      const result = await service.stop(42n, 1n);
      expect(result.endedAt).toBeInstanceOf(Date);
      expect(prisma.impersonationSession.update).toHaveBeenCalledWith({
        where: { id: 42n },
        data: { endedAt: expect.any(Date) },
      });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'IMPERSONATION_ENDED',
          actorUserId: 1n,
          resource: 'user',
          resourceId: 5n,
          impersonationSessionId: 42n,
          payload: expect.objectContaining({
            reason: 'support',
            durationSeconds: expect.any(Number),
          }),
        }),
      );
    });
  });

  describe('findActive', () => {
    it('returns the most recent active session for an actor', async () => {
      const row = { id: 1n };
      prisma.impersonationSession.findFirst.mockResolvedValue(row);

      const result = await service.findActive(7n);
      expect(result).toBe(row);
      expect(prisma.impersonationSession.findFirst).toHaveBeenCalledWith({
        where: { actorUserId: 7n, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
    });

    it('returns null when there is no active session', async () => {
      prisma.impersonationSession.findFirst.mockResolvedValue(null);
      expect(await service.findActive(7n)).toBeNull();
    });
  });
});
