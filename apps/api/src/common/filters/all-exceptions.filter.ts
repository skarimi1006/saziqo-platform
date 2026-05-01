import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { ZodError, ZodIssue } from 'zod';

import { ApiError, ApiErrorResponse, ErrorCode } from '../types/response.types';

interface MappedException {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const isProduction = process.env['NODE_ENV'] === 'production';
    const mapped = this.mapException(exception, isProduction);

    // Log non-4xx errors with full detail; client errors are noise unless verbose.
    if (mapped.status >= 500) {
      this.logger.error(`[${mapped.code}] ${mapped.message}`, this.stackOf(exception));
    } else {
      this.logger.warn(`[${mapped.code}] ${mapped.message}`);
    }

    const apiError: ApiError = { code: mapped.code, message: mapped.message };
    if (mapped.details !== undefined) {
      apiError.details = mapped.details;
    }
    const body: ApiErrorResponse = { error: apiError };

    response.status(mapped.status).json(body);
  }

  private mapException(exception: unknown, isProduction: boolean): MappedException {
    if (exception instanceof ZodError) {
      return mapZodError(exception);
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return mapPrismaError(exception);
    }
    if (exception instanceof HttpException) {
      return mapHttpException(exception);
    }
    return mapUnknownError(exception, isProduction);
  }

  private stackOf(exception: unknown): string | undefined {
    return exception instanceof Error ? exception.stack : undefined;
  }
}

function mapHttpToCode(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ErrorCode.VALIDATION_ERROR;
    case HttpStatus.UNAUTHORIZED:
      return ErrorCode.UNAUTHORIZED;
    case HttpStatus.FORBIDDEN:
      return ErrorCode.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ErrorCode.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ErrorCode.CONFLICT;
    case HttpStatus.GONE:
      return ErrorCode.GONE;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ErrorCode.RATE_LIMITED;
    default:
      return ErrorCode.INTERNAL_ERROR;
  }
}

function mapZodError(error: ZodError): MappedException {
  const fields = error.errors.map((issue: ZodIssue) => ({
    path: issue.path.map(String),
    message: issue.message,
    code: issue.code,
  }));
  return {
    status: HttpStatus.BAD_REQUEST,
    code: ErrorCode.VALIDATION_ERROR,
    message: 'Request validation failed',
    details: { fields },
  };
}

function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): MappedException {
  switch (error.code) {
    case 'P2002': {
      // Unique constraint violation
      const target = (error.meta as { target?: string[] | string })?.target;
      return {
        status: HttpStatus.CONFLICT,
        code: ErrorCode.CONFLICT,
        message: 'A record with this unique value already exists',
        details: target !== undefined ? { target } : undefined,
      };
    }
    case 'P2025':
      // Record not found
      return {
        status: HttpStatus.NOT_FOUND,
        code: ErrorCode.NOT_FOUND,
        message: 'The requested record was not found',
      };
    case 'P2003':
      // Foreign key constraint violation
      return {
        status: HttpStatus.CONFLICT,
        code: ErrorCode.CONFLICT,
        message: 'Foreign key constraint violation',
      };
    default:
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Database error',
        details: { prismaCode: error.code },
      };
  }
}

function mapHttpException(exception: HttpException): MappedException {
  const status = exception.getStatus();
  const response = exception.getResponse();
  const { code, message, details } = unpackHttpResponse(response, exception.message, status);
  return details !== undefined ? { status, code, message, details } : { status, code, message };
}

// Extracts code/message/details from an HttpException's response. The thrower
// may pass a `code` field to override the default status→code mapping (used
// e.g. by IdempotencyInterceptor to surface IDEMPOTENCY_KEY_REQUIRED on a 400).
function unpackHttpResponse(
  response: string | object,
  fallbackMessage: string,
  status: number,
): { code: string; message: string; details?: unknown } {
  if (typeof response === 'string') {
    return { code: mapHttpToCode(status), message: response };
  }
  if (response !== null && typeof response === 'object') {
    const r = response as Record<string, unknown>;
    const rawMessage = r['message'];
    let message: string;
    if (typeof rawMessage === 'string') {
      message = rawMessage;
    } else if (Array.isArray(rawMessage)) {
      message = rawMessage.join(', ');
    } else {
      message = fallbackMessage;
    }
    const code = typeof r['code'] === 'string' ? r['code'] : mapHttpToCode(status);
    const details = r['details'];
    return details !== undefined ? { code, message, details } : { code, message };
  }
  return { code: mapHttpToCode(status), message: fallbackMessage };
}

function mapUnknownError(exception: unknown, isProduction: boolean): MappedException {
  // SECURITY: In production, never leak internal error messages or stacks
  // to clients — they may contain DB structure, file paths, or secrets.
  if (isProduction) {
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    };
  }
  const message = exception instanceof Error ? exception.message : String(exception);
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: ErrorCode.INTERNAL_ERROR,
    message,
  };
}
