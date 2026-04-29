// TODO(phase-2F): remove this temporary diagnostics module after the
// middleware chain (RequestID, Logger, Security, RateLimit, Idempotency)
// has its own verification endpoints.

import { Controller, Get, NotFoundException } from '@nestjs/common';
import { z } from 'zod';

import { ZodQuery } from '../common/decorators/zod-query.decorator';

const EchoQuerySchema = z.object({
  msg: z.string().min(1, 'msg is required'),
});

const NotFoundQuerySchema = z.object({});

@Controller('_diagnostics')
export class DiagnosticsController {
  // GET /api/v1/_diagnostics/echo?msg=hello → { data: { echo: "hello" } }
  @Get('echo')
  echo(@ZodQuery(EchoQuerySchema) query: z.infer<typeof EchoQuerySchema>): { echo: string } {
    return { echo: query.msg };
  }

  // GET /api/v1/_diagnostics/not-found → 404 NOT_FOUND envelope
  @Get('not-found')
  triggerNotFound(@ZodQuery(NotFoundQuerySchema) _query: unknown): never {
    throw new NotFoundException('diagnostic resource was not found');
  }
}
