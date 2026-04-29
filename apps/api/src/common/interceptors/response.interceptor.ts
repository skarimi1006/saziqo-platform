import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { ApiSuccess, ApiMeta } from '../types/response.types';

// CLAUDE: Wraps every successful controller return into { data, meta? }.
// Detects "already wrapped" by the presence of a top-level `data` key —
// controllers that need to set `meta` (e.g. pagination) return that shape
// directly and the interceptor passes it through.
@Injectable()
export class ResponseInterceptor<T = unknown> implements NestInterceptor<T, ApiSuccess<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T>> {
    return next.handle().pipe(map((value) => wrap<T>(value)));
  }
}

function wrap<T>(value: T): ApiSuccess<T> {
  if (isAlreadyWrapped<T>(value)) {
    return value;
  }
  return { data: value };
}

function isAlreadyWrapped<T>(value: unknown): value is ApiSuccess<T> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (!('data' in obj)) {
    return false;
  }
  // If `meta` is present, it must be a plain object (not array, not null).
  if ('meta' in obj && obj['meta'] !== undefined) {
    const meta = obj['meta'];
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
      return false;
    }
    // Treat as ApiMeta — runtime shape check is loose by design.
    void (meta as ApiMeta);
  }
  return true;
}
