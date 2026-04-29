import { createHash } from 'crypto';

import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { type Request, type Response } from 'express';
import { type Observable, of } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

import { RedisService } from '../../core/redis/redis.service';
import { IDEMPOTENT_KEY } from '../decorators/idempotent.decorator';
import { ErrorCode } from '../types/response.types';

const IDEMPOTENCY_TTL_SECONDS = 86_400; // 24 hours

interface CachedResponse {
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
}

// Recursive stable JSON stringify — sorts keys at every nesting level so
// that {a:1,b:2} and {b:2,a:1} hash identically. JSON.stringify alone does
// not guarantee key order.
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value as object).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}

function computeRequestHash(method: string, url: string, body: unknown): string {
  const canonical = `${method.toUpperCase()}|${url}|${stableStringify(body ?? null)}`;
  return createHash('sha256').update(canonical).digest('hex');
}

// CLAUDE: Registered BEFORE the ResponseInterceptor in app.module.ts so
// that this interceptor sits OUTERMOST. Its pipe(map) sees the already-
// wrapped { data, meta? } envelope, which is what gets cached. On a cache
// hit it short-circuits and returns the cached envelope directly without
// re-running the handler or the response interceptor's wrapping.
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();

    const handler = context.getHandler();
    const isIdempotent = this.reflector.get<boolean>(IDEMPOTENT_KEY, handler);
    if (!isIdempotent) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const headerValue = req.headers['idempotency-key'];
    const idempotencyKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
      throw new HttpException(
        {
          code: ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
          message: 'Idempotency-Key header is required for this endpoint',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const requestHash = computeRequestHash(
      req.method,
      req.url,
      (req as Request & { body?: unknown }).body,
    );
    const cacheKey = `idem:${idempotencyKey}`;
    const client = this.redis.getClient();
    const cachedRaw = await client.get(cacheKey);

    if (cachedRaw !== null) {
      const cached = JSON.parse(cachedRaw) as CachedResponse;
      if (cached.requestHash !== requestHash) {
        // SECURITY: Same key with a different request body is a programming
        // error or a replay attack — reject so the client doesn't accidentally
        // see another request's response.
        throw new HttpException(
          {
            code: ErrorCode.IDEMPOTENCY_KEY_REUSED,
            message: 'Idempotency key was previously used with a different request body',
          },
          HttpStatus.CONFLICT,
        );
      }
      res.status(cached.responseStatus);
      return of(cached.responseBody);
    }

    // Miss path: execute, capture wrapped envelope, persist, then emit.
    // Reading HTTP_CODE_METADATA here mirrors what NestJS's
    // RouterResponseController.applyStatusCode does — at this point in
    // the pipeline res.statusCode is still the framework default.
    const httpCodeOverride = this.reflector.get<number | undefined>(HTTP_CODE_METADATA, handler);
    const defaultStatus = req.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK;
    const responseStatus = httpCodeOverride ?? defaultStatus;

    return next.handle().pipe(
      mergeMap(async (responseBody) => {
        try {
          const payload: CachedResponse = { requestHash, responseStatus, responseBody };
          await client.set(cacheKey, JSON.stringify(payload), 'EX', IDEMPOTENCY_TTL_SECONDS);
        } catch (err) {
          // Never fail the request on a cache write — just log and move on.
          this.logger.error(
            `Failed to cache idempotent response: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        return responseBody;
      }),
    );
  }
}
