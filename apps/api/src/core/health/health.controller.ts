import { Controller, Get } from '@nestjs/common';
import { z } from 'zod';

import { ZodQuery } from '../../common/decorators/zod-query.decorator';

// CLAUDE: Test Gate 2 stub. Phase 20A expands this to check database,
// Redis, and Meilisearch connectivity (and gates app boot when any
// dependency is unhealthy). For now, just confirms the API is reachable.

const HealthQuerySchema = z.object({
  format: z.enum(['summary', 'detail']).optional(),
});

@Controller('health')
export class HealthController {
  @Get()
  check(@ZodQuery(HealthQuerySchema) _query: z.infer<typeof HealthQuerySchema>): {
    status: 'ok';
  } {
    return { status: 'ok' };
  }
}
