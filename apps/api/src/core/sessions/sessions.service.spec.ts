import { createHash } from 'crypto';

import '../../common/bigint-serialization';

import { HttpException, HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jwtVerify } from 'jose';

import { ErrorCode } from '../../common/types/response.types';
import { ConfigService } from '../../config/config.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import { SessionsService } from './sessions.service';

const TEST_JWT_SECRET = 'a'.repeat(48); // ≥32 chars per Zod schema
const TEST_JWT_EXPIRES_IN = '15m';
const TEST_REFRESH_EXPIRES_IN = '30d';

interface MockPrisma {
  session: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
}

describe('SessionsService', () => {
  let service: SessionsService;
  let mockPrisma: MockPrisma;
  let mockConfig: { get: jest.Mock; isProduction: boolean };
  let mockAudit: { log: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      session: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      // The mock executes the callback with itself as the tx argument so
      // tx.session.* calls hit the same spies.
      $transaction: jest.fn(async (cb: (tx: MockPrisma) => Promise<unknown>) => cb(mockPrisma)),
    };

    mockConfig = {
      get: jest.fn((key: string): string => {
        const map: Record<string, string> = {
          JWT_SECRET: TEST_JWT_SECRET,
          JWT_EXPIRES_IN: TEST_JWT_EXPIRES_IN,
          JWT_REFRESH_EXPIRES_IN: TEST_REFRESH_EXPIRES_IN,
        };
        return map[key]!;
      }),
      isProduction: false,
    };

    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = moduleRef.get(SessionsService);
  });

  // ──────── issueTokens ────────

  describe('issueTokens', () => {
    it('persists the sha256 hash of the refresh token, never the raw value', async () => {
      mockPrisma.session.create.mockResolvedValue({ id: 1n });

      const result = await service.issueTokens(7n, 'curl/8', '127.0.0.1');

      expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
      expect(result.accessToken.split('.').length).toBe(3); // header.payload.sig

      const createArgs = mockPrisma.session.create.mock.calls[0]![0] as {
        data: {
          userId: bigint;
          refreshTokenHash: string;
          userAgent: string | null;
          ipAddress: string | null;
          expiresAt: Date;
        };
      };
      expect(createArgs.data.userId).toBe(7n);
      expect(createArgs.data.userAgent).toBe('curl/8');
      expect(createArgs.data.ipAddress).toBe('127.0.0.1');
      // hash matches sha256(raw)
      const expectedHash = createHash('sha256').update(result.refreshToken).digest('hex');
      expect(createArgs.data.refreshTokenHash).toBe(expectedHash);
      // raw token must NOT be persisted in any field
      expect(JSON.stringify(createArgs.data)).not.toContain(result.refreshToken);
    });

    it('signs an access JWT verifiable with the same secret with sub=userId', async () => {
      mockPrisma.session.create.mockResolvedValue({ id: 1n });

      const result = await service.issueTokens(42n, null, null);
      const secret = new TextEncoder().encode(TEST_JWT_SECRET);
      const { payload } = await jwtVerify(result.accessToken, secret);

      expect(payload.sub).toBe('42');
      expect(payload['type']).toBe('access');
      expect(payload.jti).toBeDefined();
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
    });

    it('returns a cookie with HttpOnly, SameSite=Strict, Path=/api/v1/auth/refresh', async () => {
      mockPrisma.session.create.mockResolvedValue({ id: 1n });
      const result = await service.issueTokens(1n, null, null);

      expect(result.refreshCookie.name).toBe('refresh_token');
      expect(result.refreshCookie.options.httpOnly).toBe(true);
      expect(result.refreshCookie.options.sameSite).toBe('strict');
      expect(result.refreshCookie.options.path).toBe('/api/v1/auth/refresh');
      expect(result.refreshCookie.options.secure).toBe(false); // dev
      expect(result.refreshCookie.options.maxAge).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('sets cookie.secure=true when NODE_ENV=production', async () => {
      mockConfig.isProduction = true;
      mockPrisma.session.create.mockResolvedValue({ id: 1n });

      const result = await service.issueTokens(1n, null, null);
      expect(result.refreshCookie.options.secure).toBe(true);
    });
  });

  // ──────── rotateRefreshToken — four flows ────────

  describe('rotateRefreshToken', () => {
    function makeStoredSession(overrides: Partial<{ revokedAt: Date | null; expiresAt: Date }>) {
      return {
        id: 1n,
        userId: 7n,
        refreshTokenHash: 'will-be-overridden',
        userAgent: 'curl',
        ipAddress: '127.0.0.1',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null as Date | null,
        createdAt: new Date(),
        ...overrides,
      };
    }

    it('valid: revokes old session and creates a new one in one transaction', async () => {
      const stored = makeStoredSession({});
      mockPrisma.session.findUnique.mockResolvedValue(stored);
      mockPrisma.session.update.mockResolvedValue({ ...stored, revokedAt: new Date() });
      mockPrisma.session.create.mockResolvedValue({ ...stored, id: 2n });

      const result = await service.rotateRefreshToken('any-raw');

      expect(result.refreshToken).toBeDefined();
      expect(result.refreshToken).not.toBe('any-raw');
      expect(result.sessionId).toBe(2n);

      // Old session was revoked
      expect(mockPrisma.session.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1n },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
      // New session created
      expect(mockPrisma.session.create).toHaveBeenCalled();
      // updateMany NOT called (no replay)
      expect(mockPrisma.session.updateMany).not.toHaveBeenCalled();
    });

    it('revoked: throws SESSION_REPLAY and revokes ALL active sessions for the user', async () => {
      const stored = makeStoredSession({ revokedAt: new Date() });
      mockPrisma.session.findUnique.mockResolvedValue(stored);
      mockPrisma.session.updateMany.mockResolvedValue({ count: 3 });

      await expect(service.rotateRefreshToken('replayed-raw')).rejects.toMatchObject({
        response: { code: ErrorCode.SESSION_REPLAY },
        status: HttpStatus.UNAUTHORIZED,
      });

      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 7n, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      // No new session created
      expect(mockPrisma.session.create).not.toHaveBeenCalled();

      // SESSION_REPLAY_DETECTED audit row is written via the outer Prisma
      // client so it survives the transaction's rollback.
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SESSION_REPLAY_DETECTED',
          actorUserId: 7n,
          resource: 'session',
        }),
      );
    });

    it('expired: throws SESSION_EXPIRED and revokes that session', async () => {
      const stored = makeStoredSession({ expiresAt: new Date(Date.now() - 1_000) });
      mockPrisma.session.findUnique.mockResolvedValue(stored);
      mockPrisma.session.update.mockResolvedValue({ ...stored, revokedAt: new Date() });

      await expect(service.rotateRefreshToken('expired-raw')).rejects.toMatchObject({
        response: { code: ErrorCode.SESSION_EXPIRED },
        status: HttpStatus.UNAUTHORIZED,
      });

      expect(mockPrisma.session.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1n },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
      expect(mockPrisma.session.create).not.toHaveBeenCalled();
    });

    it('not found: throws SESSION_INVALID without touching any other session', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(null);

      await expect(service.rotateRefreshToken('bogus-raw')).rejects.toMatchObject({
        response: { code: ErrorCode.SESSION_INVALID },
        status: HttpStatus.UNAUTHORIZED,
      });

      expect(mockPrisma.session.update).not.toHaveBeenCalled();
      expect(mockPrisma.session.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.session.create).not.toHaveBeenCalled();
    });

    it('looks up the session by sha256 hash of the incoming raw token', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(null);
      const raw = 'predictable-raw-token-for-test';
      const expectedHash = createHash('sha256').update(raw).digest('hex');

      await expect(service.rotateRefreshToken(raw)).rejects.toBeInstanceOf(HttpException);

      expect(mockPrisma.session.findUnique).toHaveBeenCalledWith({
        where: { refreshTokenHash: expectedHash },
      });
    });
  });

  // ──────── other methods ────────

  describe('revokeSession', () => {
    it('marks the session revoked', async () => {
      mockPrisma.session.update.mockResolvedValue({});
      await service.revokeSession(99n);
      expect(mockPrisma.session.update).toHaveBeenCalledWith({
        where: { id: 99n },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes every active session for the user and returns the count', async () => {
      mockPrisma.session.updateMany.mockResolvedValue({ count: 4 });
      const count = await service.revokeAllForUser(5n);
      expect(count).toBe(4);
      expect(mockPrisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 5n, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('findActive', () => {
    it('queries unrevoked, unexpired sessions ordered by createdAt desc', async () => {
      const sessions = [{ id: 1n }, { id: 2n }];
      mockPrisma.session.findMany.mockResolvedValue(sessions);

      const result = await service.findActive(5n);

      expect(result).toBe(sessions);
      expect(mockPrisma.session.findMany).toHaveBeenCalledWith({
        where: {
          userId: 5n,
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
