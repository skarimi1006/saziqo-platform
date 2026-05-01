import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { AuditService } from '../../core/audit/audit.service';
import { AUDIT_META_KEY, AuditMeta } from '../decorators/audit.decorator';
import { AuthenticatedUser, ImpersonationContext } from '../guards/jwt-auth.guard';
import { ErrorCode } from '../types/response.types';

type AuthRequest = Request & {
  user?: AuthenticatedUser;
  impersonation?: ImpersonationContext;
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditMeta | undefined>(AUDIT_META_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return next.handle();

    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<AuthRequest>();
    // SECURITY: actorUserId is the IMPERSONATOR's id whenever an impersonation
    // session is active, never the impersonated target's. The audit row's
    // `impersonationSessionId` (in payload) lets downstream readers spot
    // "X acted as Y" rows without ever crediting the action to Y.
    const actorUserId = req.impersonation?.actorUserId ?? req.user?.id ?? null;
    const ipAddress = typeof req.ip === 'string' ? req.ip : null;
    const userAgent =
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    const impersonationSessionId = req.impersonation?.impSessionId;

    const requestSnapshot = {
      method: req.method,
      path: req.originalUrl ?? req.url,
      body: cloneShallow(req.body),
    };

    return next.handle().pipe(
      tap((response) => {
        const resourceId = this.extractResourceId(meta, req, response);
        // Fire-and-forget — AuditService.log already swallows DB errors so
        // the HTTP response is never blocked by audit-write latency past the
        // initial promise's microtask.
        void this.audit.log({
          actorUserId,
          action: meta.action,
          resource: meta.resource,
          resourceId,
          payload: {
            request: requestSnapshot,
            response: cloneShallow(response),
          },
          ipAddress,
          userAgent,
          impersonationSessionId,
        });
      }),
      catchError((err: unknown) => {
        const { statusCode, errorCode } = this.classifyError(err);
        const resourceId = this.extractResourceId(meta, req, undefined);
        void this.audit.log({
          actorUserId,
          action: meta.action,
          resource: meta.resource,
          resourceId,
          failed: true,
          payload: {
            failed: true,
            statusCode,
            errorCode,
            request: requestSnapshot,
          },
          ipAddress,
          userAgent,
          impersonationSessionId,
        });
        // Re-throw so the global filter still produces the API error envelope.
        throw err;
      }),
    );
  }

  private extractResourceId(
    meta: AuditMeta,
    req: AuthRequest,
    response: unknown,
  ): bigint | string | null {
    if (!meta.resourceIdParam) return null;
    const source: 'param' | 'body' | 'response' = meta.resourceIdSource ?? 'param';
    const raw = this.readSource(source, meta.resourceIdParam, req, response);
    return normalizeResourceId(raw);
  }

  private readSource(
    source: 'param' | 'body' | 'response',
    key: string,
    req: AuthRequest,
    response: unknown,
  ): unknown {
    switch (source) {
      case 'param':
        return (req.params as Record<string, unknown> | undefined)?.[key];
      case 'body':
        return (req.body as Record<string, unknown> | null | undefined)?.[key];
      case 'response':
        return readResponseField(response, key);
    }
  }

  private classifyError(err: unknown): { statusCode: number; errorCode: string } {
    if (err instanceof HttpException) {
      const statusCode = err.getStatus();
      const response = err.getResponse();
      let errorCode: string = ErrorCode.INTERNAL_ERROR;
      if (typeof response === 'object' && response !== null) {
        const r = response as Record<string, unknown>;
        if (typeof r['code'] === 'string') {
          errorCode = r['code'];
        } else {
          errorCode = mapStatusToCode(statusCode);
        }
      } else if (typeof response === 'string') {
        errorCode = mapStatusToCode(statusCode);
      }
      return { statusCode, errorCode };
    }
    return { statusCode: 500, errorCode: ErrorCode.INTERNAL_ERROR };
  }
}

// Reads a field off the handler's return value. ResponseInterceptor wraps
// non-wrapped returns in `{ data }`, so the field can live either at the top
// of the raw return or under `data` once wrapped — we check both.
function readResponseField(response: unknown, key: string): unknown {
  if (response === null || response === undefined) return undefined;
  if (typeof response !== 'object') return undefined;
  const obj = response as Record<string, unknown>;
  if (key in obj) return obj[key];
  const data = obj['data'];
  if (data !== null && typeof data === 'object' && key in (data as Record<string, unknown>)) {
    return (data as Record<string, unknown>)[key];
  }
  return undefined;
}

function normalizeResourceId(raw: unknown): bigint | string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'bigint') return raw;
  if (typeof raw === 'string') {
    if (/^-?\d+$/.test(raw)) {
      try {
        return BigInt(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  }
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    try {
      return BigInt(raw);
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}

function mapStatusToCode(status: number): string {
  if (status === 400) return ErrorCode.VALIDATION_ERROR;
  if (status === 401) return ErrorCode.UNAUTHORIZED;
  if (status === 403) return ErrorCode.FORBIDDEN;
  if (status === 404) return ErrorCode.NOT_FOUND;
  if (status === 409) return ErrorCode.CONFLICT;
  if (status === 412) return ErrorCode.ADMIN_CONFIRM_REQUIRED;
  if (status === 429) return ErrorCode.RATE_LIMITED;
  return ErrorCode.INTERNAL_ERROR;
}

// SECURITY: We never freeze or deep-mutate; just shallow-copy so the audit
// payload in the row is decoupled from the live request/response object.
// AuditService.log redacts sensitive keys before hashing/persisting, so it
// is safe to pass redactable fields through unchanged here.
function cloneShallow<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return [...value] as unknown as T;
  return { ...(value as Record<string, unknown>) } as T;
}
