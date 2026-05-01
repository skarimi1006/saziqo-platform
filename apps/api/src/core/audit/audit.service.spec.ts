import '../../common/bigint-serialization';

import { createHash } from 'crypto';

import { Test } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';

import { AUDIT_ACTIONS } from './actions.catalog';
import { AuditService } from './audit.service';
import { canonicalJSONStringify } from './canonical-json';
import { redactSensitivePayload } from './redaction';

interface MockPrisma {
  auditLog: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
  };
}

function expectedHash(payload: Record<string, unknown>, impSessionId?: bigint): string {
  const redacted = redactSensitivePayload(payload) as Record<string, unknown>;
  const full =
    impSessionId !== undefined
      ? { ...redacted, impersonationSessionId: String(impSessionId) }
      : redacted;
  return createHash('sha256').update(canonicalJSONStringify(full)).digest('hex');
}

describe('AuditService', () => {
  let service: AuditService;
  let prisma: MockPrisma;

  beforeEach(async () => {
    prisma = {
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AuditService);
  });

  describe('log', () => {
    it('writes a row with sha256(canonicalJSON(redactedPayload)) as payloadHash', async () => {
      const payload = { from: 'PENDING_PROFILE', to: 'ACTIVE' };
      await service.log({
        actorUserId: 1n,
        action: AUDIT_ACTIONS.ADMIN_USER_STATUS_CHANGED,
        resource: 'user',
        resourceId: 5n,
        payload,
        ipAddress: '127.0.0.1',
        userAgent: 'curl/8',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorUserId: 1n,
          action: AUDIT_ACTIONS.ADMIN_USER_STATUS_CHANGED,
          resource: 'user',
          resourceId: '5',
          payloadHash: expectedHash(payload),
          ipAddress: '127.0.0.1',
          userAgent: 'curl/8',
        },
      });
    });

    it('redacts sensitive payload fields before hashing — refreshToken is not present in the hashed input', async () => {
      const payloadWithSecret = { refreshToken: 'leaky-rt', userId: 7 };
      const payloadWithoutSecret = { refreshToken: 'different-leaky', userId: 7 };

      await service.log({
        actorUserId: 1n,
        action: AUDIT_ACTIONS.LOGIN_SUCCESS,
        resource: 'user',
        resourceId: 7n,
        payload: payloadWithSecret,
        ipAddress: null,
        userAgent: null,
      });
      const hashFirst = (
        prisma.auditLog.create.mock.calls[0]![0] as { data: { payloadHash: string } }
      ).data.payloadHash;

      await service.log({
        actorUserId: 1n,
        action: AUDIT_ACTIONS.LOGIN_SUCCESS,
        resource: 'user',
        resourceId: 7n,
        payload: payloadWithoutSecret,
        ipAddress: null,
        userAgent: null,
      });
      const hashSecond = (
        prisma.auditLog.create.mock.calls[1]![0] as { data: { payloadHash: string } }
      ).data.payloadHash;

      // Both refreshToken values redact to [REDACTED] — same hash.
      expect(hashFirst).toBe(hashSecond);
    });

    it('stamps impersonationSessionId into the hashed payload when provided', async () => {
      const payload = { reason: 'support ticket #1234' };
      await service.log({
        actorUserId: 1n,
        action: AUDIT_ACTIONS.IMPERSONATION_STARTED,
        resource: 'user',
        resourceId: 5n,
        payload,
        ipAddress: null,
        userAgent: null,
        impersonationSessionId: 42n,
      });

      const arg = prisma.auditLog.create.mock.calls[0]![0] as { data: { payloadHash: string } };
      expect(arg.data.payloadHash).toBe(expectedHash(payload, 42n));
      expect(arg.data.payloadHash).not.toBe(expectedHash(payload));
    });

    it('coerces resourceId bigint to string and accepts null for system actions', async () => {
      await service.log({
        actorUserId: null,
        action: AUDIT_ACTIONS.MAINTENANCE_TOGGLED,
        resource: 'maintenance',
        resourceId: null,
        payload: { enabled: true },
        ipAddress: null,
        userAgent: null,
      });
      const arg = prisma.auditLog.create.mock.calls[0]![0] as {
        data: { actorUserId: bigint | null; resourceId: string | null };
      };
      expect(arg.data.actorUserId).toBeNull();
      expect(arg.data.resourceId).toBeNull();
    });

    it('does not throw to the caller when the DB write fails — audit failures must not break the action', async () => {
      prisma.auditLog.create.mockRejectedValueOnce(new Error('connection lost'));
      await expect(
        service.log({
          actorUserId: 1n,
          action: AUDIT_ACTIONS.LOGIN_SUCCESS,
          resource: 'user',
          resourceId: 1n,
          payload: {},
          ipAddress: null,
          userAgent: null,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('findMany', () => {
    it('applies all filters and uses cursor pagination', async () => {
      prisma.auditLog.findMany.mockResolvedValue([{ id: 3n }, { id: 2n }, { id: 1n }]);

      const after = new Date('2026-01-01');
      const before = new Date('2026-12-31');
      const result = await service.findMany(
        {
          actorUserId: 7n,
          action: 'LOGIN_SUCCESS',
          resource: 'user',
          resourceId: '5',
          createdAfter: after,
          createdBefore: before,
        },
        { cursor: 100n, limit: 2 },
      );

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          actorUserId: 7n,
          action: 'LOGIN_SUCCESS',
          resource: 'user',
          resourceId: '5',
          createdAt: { gte: after, lte: before },
          id: { lt: 100n },
        },
        orderBy: { id: 'desc' },
        take: 3,
      });
      expect(result.hasMore).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBe(2n);
    });

    it('returns hasMore=false and nextCursor=null when fewer rows than limit are returned', async () => {
      prisma.auditLog.findMany.mockResolvedValue([{ id: 1n }]);
      const result = await service.findMany({}, { limit: 5 });
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(result.items).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('returns the row by id', async () => {
      prisma.auditLog.findUnique.mockResolvedValue({ id: 1n });
      const result = await service.findById(1n);
      expect(result).toEqual({ id: 1n });
      expect(prisma.auditLog.findUnique).toHaveBeenCalledWith({ where: { id: 1n } });
    });
  });
});
