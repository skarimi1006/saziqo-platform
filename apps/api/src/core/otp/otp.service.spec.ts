// jest.mock is hoisted; we wrap the real crypto module so timingSafeEqual
// becomes spy-able. Without this jest.spyOn fails because Node's crypto
// exports are non-configurable.
jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto') as typeof import('crypto');
  return {
    ...actual,
    timingSafeEqual: jest.fn((a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView): boolean =>
      actual.timingSafeEqual(a, b),
    ),
  };
});

import * as crypto from 'crypto';

import { HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OtpAttempt } from '@prisma/client';

import { ErrorCode } from '../../common/types/response.types';
import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';

import { OtpService } from './otp.service';

const TEST_OTP_SALT = 'a'.repeat(64);
const TEST_PHONE = '+989123456789';

interface MockPrisma {
  otpAttempt: {
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
}

interface MockRedisClient {
  set: jest.Mock;
  get: jest.Mock;
  del: jest.Mock;
  ttl: jest.Mock;
}

function hashOf(code: string, phone: string): string {
  return crypto.createHash('sha256').update(`${code}${phone}${TEST_OTP_SALT}`).digest('hex');
}

describe('OtpService', () => {
  let service: OtpService;
  let mockPrisma: MockPrisma;
  let mockRedisClient: MockRedisClient;
  let mockRedis: { getClient: jest.Mock };
  let mockConfig: { get: jest.Mock };
  let mockUsers: { findByPhone: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      otpAttempt: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    mockRedisClient = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
      ttl: jest.fn().mockResolvedValue(45),
    };

    mockRedis = { getClient: jest.fn(() => mockRedisClient) };

    mockConfig = {
      get: jest.fn((key: string): string | undefined => {
        if (key === 'OTP_SALT') return TEST_OTP_SALT;
        return undefined;
      }),
    };

    mockUsers = { findByPhone: jest.fn().mockResolvedValue(null) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        { provide: ConfigService, useValue: mockConfig },
        { provide: UsersService, useValue: mockUsers },
      ],
    }).compile();

    service = moduleRef.get(OtpService);
  });

  function makeAttempt(overrides: Partial<OtpAttempt> = {}): OtpAttempt {
    return {
      id: 1n,
      phone: TEST_PHONE,
      codeHash: hashOf('123456', TEST_PHONE),
      attempts: 0,
      expiresAt: new Date(Date.now() + 120_000),
      consumedAt: null,
      createdAt: new Date(),
      ...overrides,
    };
  }

  // ──────── generateAndStore ────────

  describe('generateAndStore', () => {
    beforeEach(() => {
      mockPrisma.otpAttempt.create.mockResolvedValue(makeAttempt());
    });

    it('generates a 6-digit numeric code in the [100000, 999999] range', async () => {
      const result = await service.generateAndStore(TEST_PHONE);
      expect(result.code).toMatch(/^\d{6}$/);
      const n = parseInt(result.code, 10);
      expect(n).toBeGreaterThanOrEqual(100_000);
      expect(n).toBeLessThanOrEqual(999_999);
    });

    it('returns expiresInSeconds=120', async () => {
      const result = await service.generateAndStore(TEST_PHONE);
      expect(result.expiresInSeconds).toBe(120);
    });

    it('persists sha256(code+phone+salt) and never the raw code', async () => {
      const result = await service.generateAndStore(TEST_PHONE);
      const createArgs = mockPrisma.otpAttempt.create.mock.calls[0]![0] as {
        data: { phone: string; codeHash: string; expiresAt: Date; attempts: number };
      };
      expect(createArgs.data.codeHash).toBe(hashOf(result.code, TEST_PHONE));
      expect(createArgs.data.phone).toBe(TEST_PHONE);
      expect(createArgs.data.attempts).toBe(0);
      expect(createArgs.data.expiresAt).toBeInstanceOf(Date);
      expect(JSON.stringify(createArgs.data)).not.toContain(result.code);
    });

    it('writes Redis otp:{phone} = codeHash with TTL 120s', async () => {
      await service.generateAndStore(TEST_PHONE);
      const codeSet = mockRedisClient.set.mock.calls.find((c) => c[0] === `otp:${TEST_PHONE}`);
      expect(codeSet).toBeDefined();
      expect(codeSet![1]).toMatch(/^[0-9a-f]{64}$/);
      expect(codeSet![2]).toBe('EX');
      expect(codeSet![3]).toBe(120);
    });

    it('acquires the rate-limit lock atomically (NX EX 60)', async () => {
      await service.generateAndStore(TEST_PHONE);
      const lockSet = mockRedisClient.set.mock.calls.find((c) => c[0] === `otp:lock:${TEST_PHONE}`);
      expect(lockSet).toEqual([`otp:lock:${TEST_PHONE}`, '1', 'EX', 60, 'NX']);
    });

    it('throws OTP_RATE_LIMITED with retryAfterSeconds when lock already exists', async () => {
      mockRedisClient.set.mockImplementation(async (...args: unknown[]) => {
        if (args[0] === `otp:lock:${TEST_PHONE}` && args.includes('NX')) return null;
        return 'OK';
      });
      mockRedisClient.ttl.mockResolvedValue(42);

      await expect(service.generateAndStore(TEST_PHONE)).rejects.toMatchObject({
        response: {
          code: ErrorCode.OTP_RATE_LIMITED,
          details: { retryAfterSeconds: 42 },
        },
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
      expect(mockPrisma.otpAttempt.create).not.toHaveBeenCalled();
    });

    it('clamps a negative TTL to 0 in retryAfterSeconds', async () => {
      mockRedisClient.set.mockImplementation(async (...args: unknown[]) => {
        if (args[0] === `otp:lock:${TEST_PHONE}` && args.includes('NX')) return null;
        return 'OK';
      });
      mockRedisClient.ttl.mockResolvedValue(-2); // key exists but no TTL set

      await expect(service.generateAndStore(TEST_PHONE)).rejects.toMatchObject({
        response: { details: { retryAfterSeconds: 0 } },
      });
    });
  });

  // ──────── verify ────────

  describe('verify', () => {
    it('returns OTP_NOT_FOUND when neither Redis nor DB have a row', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      mockPrisma.otpAttempt.findFirst.mockResolvedValue(null);

      const result = await service.verify(TEST_PHONE, '123456');
      expect(result).toEqual({ valid: false, reason: 'OTP_NOT_FOUND' });
      expect(mockPrisma.otpAttempt.update).not.toHaveBeenCalled();
    });

    it('falls back to DB when Redis evicted the key', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      const attempt = makeAttempt({ codeHash: hashOf('123456', TEST_PHONE) });
      mockPrisma.otpAttempt.findFirst.mockResolvedValue(attempt);
      mockPrisma.otpAttempt.update.mockResolvedValue({ ...attempt, attempts: 1 });

      const result = await service.verify(TEST_PHONE, '123456');
      expect(result).toEqual({ valid: true, userExists: false });
      // Fallback path queries by phone alone (no codeHash filter)
      expect(mockPrisma.otpAttempt.findFirst).toHaveBeenCalledWith({
        where: { phone: TEST_PHONE, consumedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('returns OTP_EXPIRED and clears Redis without incrementing attempts', async () => {
      const attempt = makeAttempt({ expiresAt: new Date(Date.now() - 1_000) });
      mockRedisClient.get.mockResolvedValue(attempt.codeHash);
      mockPrisma.otpAttempt.findFirst.mockResolvedValue(attempt);

      const result = await service.verify(TEST_PHONE, '123456');
      expect(result).toEqual({ valid: false, reason: 'OTP_EXPIRED' });
      expect(mockRedisClient.del).toHaveBeenCalledWith(`otp:${TEST_PHONE}`);
      expect(mockPrisma.otpAttempt.update).not.toHaveBeenCalled();
    });

    it('returns OTP_INVALID on hash mismatch', async () => {
      const attempt = makeAttempt();
      mockRedisClient.get.mockResolvedValue(attempt.codeHash);
      mockPrisma.otpAttempt.findFirst.mockResolvedValue(attempt);
      mockPrisma.otpAttempt.update.mockResolvedValue({ ...attempt, attempts: 1 });

      const result = await service.verify(TEST_PHONE, '999999');
      expect(result).toEqual({ valid: false, reason: 'OTP_INVALID' });
    });

    it('returns valid:true userExists:true when user exists', async () => {
      const attempt = makeAttempt({ codeHash: hashOf('123456', TEST_PHONE) });
      mockRedisClient.get.mockResolvedValue(attempt.codeHash);
      mockPrisma.otpAttempt.findFirst.mockResolvedValue(attempt);
      mockPrisma.otpAttempt.update.mockResolvedValue({ ...attempt, attempts: 1 });
      mockUsers.findByPhone.mockResolvedValue({ id: 7n, phone: TEST_PHONE });

      const result = await service.verify(TEST_PHONE, '123456');
      expect(result).toEqual({ valid: true, userExists: true });
    });

    it('returns valid:true userExists:false when user does not exist', async () => {
      const attempt = makeAttempt({ codeHash: hashOf('123456', TEST_PHONE) });
      mockRedisClient.get.mockResolvedValue(attempt.codeHash);
      mockPrisma.otpAttempt.findFirst.mockResolvedValue(attempt);
      mockPrisma.otpAttempt.update.mockResolvedValue({ ...attempt, attempts: 1 });
      mockUsers.findByPhone.mockResolvedValue(null);

      const result = await service.verify(TEST_PHONE, '123456');
      expect(result).toEqual({ valid: true, userExists: false });
    });

    it('throws OTP_TOO_MANY_ATTEMPTS once attempts exceed 5 and clears Redis', async () => {
      const attempt = makeAttempt({ attempts: 5 });
      mockRedisClient.get.mockResolvedValue(attempt.codeHash);
      mockPrisma.otpAttempt.findFirst.mockResolvedValue(attempt);
      mockPrisma.otpAttempt.update.mockResolvedValue({ ...attempt, attempts: 6 });

      await expect(service.verify(TEST_PHONE, '999999')).rejects.toMatchObject({
        response: { code: ErrorCode.OTP_TOO_MANY_ATTEMPTS },
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
      expect(mockRedisClient.del).toHaveBeenCalledWith(`otp:${TEST_PHONE}`);
    });

    // SECURITY: Hash compare must be constant-time so an attacker cannot
    // pinpoint where their guess diverges from the true hash via response
    // timing.
    it('uses crypto.timingSafeEqual with two equal-length 32-byte buffers', async () => {
      const attempt = makeAttempt({ codeHash: hashOf('123456', TEST_PHONE) });
      mockRedisClient.get.mockResolvedValue(attempt.codeHash);
      mockPrisma.otpAttempt.findFirst.mockResolvedValue(attempt);
      mockPrisma.otpAttempt.update.mockResolvedValue({ ...attempt, attempts: 1 });

      const tseMock = crypto.timingSafeEqual as unknown as jest.Mock;
      tseMock.mockClear();

      await service.verify(TEST_PHONE, '999999');

      expect(tseMock).toHaveBeenCalledTimes(1);
      const [a, b] = tseMock.mock.calls[0]!;
      expect((a as Buffer).length).toBe(32);
      expect((b as Buffer).length).toBe(32);
    });

    it('takes the same compare path for matching and mismatching codes (timing parity)', async () => {
      const correct = '123456';
      const wrong = '999999';
      const attempt = makeAttempt({ codeHash: hashOf(correct, TEST_PHONE) });
      mockRedisClient.get.mockResolvedValue(attempt.codeHash);
      mockPrisma.otpAttempt.findFirst.mockResolvedValue(attempt);
      mockPrisma.otpAttempt.update.mockResolvedValue({ ...attempt, attempts: 1 });

      const tseMock = crypto.timingSafeEqual as unknown as jest.Mock;

      // Each verify call hashes once and calls timingSafeEqual exactly
      // once, regardless of whether the code matches — so an attacker
      // cannot distinguish hit from miss by counting compare operations.
      tseMock.mockClear();
      await service.verify(TEST_PHONE, wrong);
      const wrongCalls = tseMock.mock.calls.length;

      tseMock.mockClear();
      await service.verify(TEST_PHONE, correct);
      const correctCalls = tseMock.mock.calls.length;

      expect(wrongCalls).toBe(1);
      expect(correctCalls).toBe(1);
    });
  });

  // ──────── consume ────────

  describe('consume', () => {
    it('marks the matching attempt consumed and clears Redis', async () => {
      mockPrisma.otpAttempt.updateMany.mockResolvedValue({ count: 1 });

      await service.consume(TEST_PHONE, '123456');

      expect(mockRedisClient.del).toHaveBeenCalledWith(`otp:${TEST_PHONE}`);
      expect(mockPrisma.otpAttempt.updateMany).toHaveBeenCalledWith({
        where: {
          phone: TEST_PHONE,
          codeHash: hashOf('123456', TEST_PHONE),
          consumedAt: null,
        },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('is idempotent — second call updates 0 rows but does not throw', async () => {
      mockPrisma.otpAttempt.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      await service.consume(TEST_PHONE, '123456');
      await expect(service.consume(TEST_PHONE, '123456')).resolves.toBeUndefined();
    });
  });
});
