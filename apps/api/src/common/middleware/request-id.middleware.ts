import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Augment http.IncomingMessage with requestId. Express.Request extends
// IncomingMessage, and pino-http types its req as the bare IncomingMessage,
// so augmenting at this level is visible to both.
declare module 'http' {
  interface IncomingMessage {
    requestId?: string;
  }
}

const VALID_REQUEST_ID = /^[a-zA-Z0-9_-]{1,128}$/;

function isValidIncomingId(value: unknown): value is string {
  return typeof value === 'string' && VALID_REQUEST_ID.test(value);
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  // SECURITY: incoming X-Request-Id is validated against a strict regex.
  // Without validation, a malicious client could inject control chars or
  // newlines into structured logs (log forging).
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const requestId = isValidIncomingId(incoming) ? incoming : uuidv4();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
