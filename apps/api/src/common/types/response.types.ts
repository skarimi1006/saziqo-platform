// CLAUDE: This file defines the canonical API response shape. Every
// module MUST conform to it via the global ResponseInterceptor and
// AllExceptionsFilter. Adding a new error code is allowed; renaming
// or removing one is a breaking change for v1 consumers.

export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',
  IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface ApiPagination {
  nextCursor?: string;
  limit: number;
}

export interface ApiMeta {
  pagination?: ApiPagination;
  // Modules may attach additional metadata under this index signature.
  [key: string]: unknown;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
  // requestId is filled by the global filter once Phase 2D adds X-Request-Id.
  requestId?: string;
}

export interface ApiSuccess<T> {
  data: T;
  meta?: ApiMeta;
}

export interface ApiErrorResponse {
  error: ApiError;
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiErrorResponse;

// Type guard helpers for consumers
export function isApiSuccess<T>(r: ApiResponse<T>): r is ApiSuccess<T> {
  return 'data' in r;
}

export function isApiError<T>(r: ApiResponse<T>): r is ApiErrorResponse {
  return 'error' in r;
}
