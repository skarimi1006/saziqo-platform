import * as crypto from 'crypto';

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { OtpAttempt } from '@prisma/client';

import { ErrorCode } from '../../common/types/response.types';
import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';

const OTP_TTL_SECONDS = 120;
const OTP_LOCK_SECONDS = 60;
const MAX_ATTEMPTS = 5;

const otpKey = (phone: string): string => `otp:${phone}`;
const lockKey = (phone: string): string => `otp:lock:${phone}`;

export type VerifyResult =
  | { valid: true; userExists: boolean }
  | { valid: false; reason: 'OTP_NOT_FOUND' | 'OTP_EXPIRED' | 'OTP_INVALID' };

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  // SECURITY: Generates a 6-digit OTP. The raw code returns to the caller
  // exactly once for SMS dispatch; only its sha256 hash (with phone + salt)
  // is persisted, so a leaked DB cannot recover live codes by precomputation.
  async generateAndStore(phone: string): Promise<{ code: string; expiresInSeconds: number }> {
    const client = this.redis.getClient();

    // Atomic SET ... NX EX so two concurrent requests cannot both pass the
    // rate-limit gate. If the lock already exists, return the remaining TTL
    // so the caller can render an accurate cooldown.
    const acquired = await client.set(lockKey(phone), '1', 'EX', OTP_LOCK_SECONDS, 'NX');
    if (acquired === null) {
      const ttl = await client.ttl(lockKey(phone));
      throw new HttpException(
        {
          code: ErrorCode.OTP_RATE_LIMITED,
          message: 'OTP can be requested again after the cooldown',
          details: { retryAfterSeconds: Math.max(ttl, 0) },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = this.generateCode();
    const codeHash = this.hashCode(code, phone);
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

    await this.prisma.otpAttempt.create({
      data: { phone, codeHash, expiresAt, attempts: 0 },
    });

    // Redis is the fast path for verification; the DB row is the audit trail
    // and the fallback if Redis evicts the key under memory pressure.
    await client.set(otpKey(phone), codeHash, 'EX', OTP_TTL_SECONDS);

    return { code, expiresInSeconds: OTP_TTL_SECONDS };
  }

  async verify(phone: string, submittedCode: string): Promise<VerifyResult> {
    const client = this.redis.getClient();

    let codeHash = await client.get(otpKey(phone));
    let attempt: OtpAttempt | null;

    if (codeHash) {
      attempt = await this.prisma.otpAttempt.findFirst({
        where: { phone, codeHash, consumedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    } else {
      // Redis evicted the key but the DB still has the row: load the latest
      // unconsumed attempt and use its hash for the compare.
      attempt = await this.prisma.otpAttempt.findFirst({
        where: { phone, consumedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      codeHash = attempt?.codeHash ?? null;
    }

    if (!attempt || !codeHash) {
      return { valid: false, reason: 'OTP_NOT_FOUND' };
    }

    if (attempt.expiresAt.getTime() < Date.now()) {
      await client.del(otpKey(phone));
      return { valid: false, reason: 'OTP_EXPIRED' };
    }

    // SECURITY: Increment attempts BEFORE comparing so a brute-force loop
    // is throttled by the counter even if the attacker happens to land
    // on the right code on the 6th try.
    const updated = await this.prisma.otpAttempt.update({
      where: { id: attempt.id },
      data: { attempts: { increment: 1 } },
    });

    if (updated.attempts > MAX_ATTEMPTS) {
      await client.del(otpKey(phone));
      throw new HttpException(
        {
          code: ErrorCode.OTP_TOO_MANY_ATTEMPTS,
          message: 'Too many failed verification attempts; request a new OTP',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const submittedHash = this.hashCode(submittedCode, phone);
    const a = Buffer.from(submittedHash, 'hex');
    const b = Buffer.from(codeHash, 'hex');

    // SECURITY: timingSafeEqual prevents an attacker from learning where
    // their guess diverges from the true hash by measuring response times.
    // Both buffers are sha256 hex (32 bytes each), so length is equal by
    // construction — but the explicit guard is kept because timingSafeEqual
    // throws if lengths differ, which would itself be a timing leak.
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { valid: false, reason: 'OTP_INVALID' };
    }

    const user = await this.usersService.findByPhone(phone);
    return { valid: true, userExists: user !== null };
  }

  // Idempotent: marks the matching unconsumed attempt as consumed and clears
  // the Redis fast-path entry. Calling twice with the same code updates 0
  // rows on the second call (consumedAt: null no longer matches) — by design.
  async consume(phone: string, code: string): Promise<void> {
    const codeHash = this.hashCode(code, phone);
    await this.redis.getClient().del(otpKey(phone));
    await this.prisma.otpAttempt.updateMany({
      where: { phone, codeHash, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }

  // ──────── private helpers ────────

  private generateCode(): string {
    // crypto.randomInt(min, max) is upper-exclusive, so 1_000_000 is needed
    // to include 999999 in the output range.
    return String(crypto.randomInt(100_000, 1_000_000));
  }

  private hashCode(code: string, phone: string): string {
    const salt = this.config.get('OTP_SALT');
    return crypto.createHash('sha256').update(`${code}${phone}${salt}`).digest('hex');
  }
}
