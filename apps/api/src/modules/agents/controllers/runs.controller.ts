import { Controller, HttpException, HttpStatus, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { Public } from '../../../common/decorators/public.decorator';
import { RateLimit } from '../../../common/decorators/rate-limit.decorator';
import { ZodBody } from '../../../common/decorators/zod-body.decorator';
import { ErrorCode } from '../../../common/types/response.types';
import { RunsService, type ConsumeResult } from '../services/runs.service';

const ConsumeBodySchema = z.object({
  listingSlug: z.string().min(1).max(120),
  userId: z.coerce.bigint(),
});

@Controller('agents/runs')
export class AgentsRunsController {
  constructor(private readonly runsService: RunsService) {}

  // CLAUDE: This endpoint authenticates with the X-Agent-API-Key header
  // — NOT a JWT. The maker's external service holds the key for one
  // listing they own; it has no user identity. Public + rate-limited
  // by IP at 1000/min: legitimate maker services may burst, but
  // anything past that is either misuse or attempted brute force.
  @Post('consume')
  @Public()
  @RateLimit({ ip: '1000/min' })
  async consume(
    @ZodBody(ConsumeBodySchema) body: z.infer<typeof ConsumeBodySchema>,
    @Headers('x-agent-api-key') apiKeyHeader: string | undefined,
    @Req() req: Request,
  ): Promise<{ data: ConsumeResult }> {
    if (!apiKeyHeader || typeof apiKeyHeader !== 'string') {
      throw new HttpException(
        { code: ErrorCode.INVALID_API_KEY, message: 'Missing X-Agent-API-Key header' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const ipAddress = typeof req.ip === 'string' ? req.ip : null;
    const userAgent =
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;

    const result = await this.runsService.consume({
      listingSlug: body.listingSlug,
      userId: body.userId,
      apiKeyPlaintext: apiKeyHeader,
      ipAddress,
      userAgent,
    });

    return { data: result };
  }
}
