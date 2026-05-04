import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';

import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

type CheckStatus = 'ok' | 'failed';

interface HealthChecks {
  db: CheckStatus;
  redis: CheckStatus;
}

interface HealthResponse {
  status: 'ok';
  uptime: number;
  checks: HealthChecks;
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @Public()
  async check(): Promise<HealthResponse> {
    const checks: HealthChecks = { db: 'ok', redis: 'ok' };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      checks.db = 'failed';
    }

    try {
      const client = this.redis.getClient();
      // Hard-timeout prevents blocking the health response while ioredis works
      // through its maxRetriesPerRequest cycle (200+400+600ms = ~1.2s by default).
      // The status check is a fast pre-flight; the race is the safety net.
      if (client.status !== 'ready') {
        throw new Error(`Redis not ready (status: ${client.status})`);
      }
      const pingPromise = client.ping();
      // Suppress the eventual rejection on the floating promise so it does not
      // become an unhandled rejection after the timeout branch wins the race.
      pingPromise.catch(() => {});
      await Promise.race([
        pingPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Redis ping timeout (1s)')), 1000),
        ),
      ]);
    } catch {
      checks.redis = 'failed';
    }

    const failed = (Object.entries(checks) as [string, CheckStatus][])
      .filter(([, v]) => v === 'failed')
      .map(([k]) => k);

    if (failed.length > 0) {
      throw new HttpException(
        {
          code: 'UNHEALTHY',
          message: 'One or more health checks failed',
          details: { failed },
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return { status: 'ok', uptime: process.uptime(), checks };
  }
}
