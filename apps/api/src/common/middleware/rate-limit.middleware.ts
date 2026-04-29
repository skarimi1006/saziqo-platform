import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

import { RedisService } from '../../core/redis/redis.service';
import {
  DEFAULT_RATE_LIMIT_PROFILE,
  RATE_LIMIT_KEY,
  type RateLimitProfile,
} from '../decorators/rate-limit.decorator';

// CLAUDE: Spec asked for a "middleware" that reads decorator metadata via
// Reflector. NestJS middleware fires before route resolution and has no
// ExecutionContext, so it cannot read route metadata. Implementing as a
// Guard is functionally equivalent — both run before the handler — and is
// the canonical NestJS way to gate a request based on per-route metadata.
// Registered globally via APP_GUARD in app.module.ts.

// Atomic sliding-window check via Lua. Uses a sorted set per (scope, id):
//   ZREMRANGEBYSCORE drops anything older than (now - windowMs)
//   ZCARD counts entries currently in the window
//   if at-or-over limit  → return [0, 0, oldestScore + windowMs]
//   else ZADD + PEXPIRE  → return [1, remaining, oldestScore + windowMs]
// Returning oldestScore + windowMs as the reset time: this is when the
// oldest entry in the window will fall off, freeing a slot.
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)
local count = redis.call('ZCARD', key)

if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldestScore = tonumber(oldest[2])
  return { 0, 0, oldestScore + windowMs }
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, windowMs)

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldestScore = (oldest[2] and tonumber(oldest[2])) or now
return { 1, limit - count - 1, oldestScore + windowMs }
`;

interface ParsedLimit {
  limit: number;
  windowMs: number;
}

interface CheckResult {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
}

interface LimitCheck {
  scope: 'ip' | 'user';
  id: string;
  parsed: ParsedLimit;
}

const UNIT_TO_MS = {
  sec: 1_000,
  min: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
} as const;

function parseSpec(spec: string): ParsedLimit {
  const match = /^(\d+)\/(sec|min|hour|day)$/i.exec(spec);
  if (!match) {
    throw new Error(`Invalid rate-limit spec: ${spec}`);
  }
  const limit = Number(match[1]);
  const unit = match[2]!.toLowerCase() as keyof typeof UNIT_TO_MS;
  return { limit, windowMs: UNIT_TO_MS[unit] };
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Only apply to HTTP requests; passes through GraphQL/RPC if any are
    // ever added. This avoids breaking non-HTTP execution contexts.
    if (context.getType() !== 'http') return true;

    const handler = context.getHandler();
    const cls = context.getClass();
    const profile =
      this.reflector.getAllAndOverride<RateLimitProfile>(RATE_LIMIT_KEY, [handler, cls]) ??
      DEFAULT_RATE_LIMIT_PROFILE;

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    // SECURITY: req.ip relies on Express's connection.remoteAddress unless
    // app.set('trust proxy', ...) is configured (Phase 21 behind Caddy).
    // For dev/test, req.ip is loopback (::1 or 127.0.0.1).
    const ip = req.ip ?? 'unknown';
    // TODO(phase-3J): wire userId from authenticated session for user-scoped checks.
    const userId = (req as Request & { userId?: string }).userId;

    const checks: LimitCheck[] = [];
    if (profile.ip) checks.push({ scope: 'ip', id: ip, parsed: parseSpec(profile.ip) });
    if (profile.user && userId) {
      checks.push({ scope: 'user', id: String(userId), parsed: parseSpec(profile.user) });
    }

    if (checks.length === 0) return true;

    let mostRestrictive: { check: LimitCheck; result: CheckResult } | null = null;

    for (const check of checks) {
      const result = await this.runCheck(check);

      const isMoreRestrictive =
        mostRestrictive === null || result.remaining < mostRestrictive.result.remaining;
      if (isMoreRestrictive) {
        mostRestrictive = { check, result };
      }

      if (!result.allowed) {
        this.setRateLimitHeaders(res, check.parsed, result);
        const retryAfterSec = Math.max(1, Math.ceil((result.resetAtMs - Date.now()) / 1000));
        res.setHeader('Retry-After', String(retryAfterSec));
        // SECURITY: super_admin bypass intentionally NOT implemented yet —
        // wire in once auth is available (Phase 3J + 4D role seeding).
        throw new HttpException(
          {
            message: `Rate limit exceeded for scope ${check.scope}`,
            details: {
              scope: check.scope,
              limit: check.parsed.limit,
              windowMs: check.parsed.windowMs,
              resetAtMs: result.resetAtMs,
              retryAfterSec,
            },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    if (mostRestrictive !== null) {
      this.setRateLimitHeaders(res, mostRestrictive.check.parsed, mostRestrictive.result);
    }

    return true;
  }

  private async runCheck(check: LimitCheck): Promise<CheckResult> {
    const key = `ratelimit:${check.scope}:${check.id}`;
    const now = Date.now();
    // Member must be unique per request (same-ms collisions otherwise drop entries).
    const member = `${now}-${uuidv4().slice(0, 8)}`;

    const client = this.redis.getClient();
    const reply = (await client.eval(
      SLIDING_WINDOW_LUA,
      1,
      key,
      String(now),
      String(check.parsed.windowMs),
      String(check.parsed.limit),
      member,
    )) as [number, number, number];

    return {
      allowed: reply[0] === 1,
      remaining: reply[1],
      resetAtMs: reply[2],
    };
  }

  private setRateLimitHeaders(res: Response, parsed: ParsedLimit, result: CheckResult): void {
    res.setHeader('X-RateLimit-Limit', String(parsed.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, result.remaining)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAtMs / 1000)));
  }
}
