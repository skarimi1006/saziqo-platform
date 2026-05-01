import { Controller, Get, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodQuery } from '../../common/decorators/zod-query.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';

import { LedgerService } from './ledger.service';

const ReconciliationQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? Math.min(parseInt(v, 10), 10000) : 10000)),
});

const AggregatesQuerySchema = z.object({
  days: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? Math.min(parseInt(v, 10), 365) : 30)),
});

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('admin/ledger')
export class LedgerAdminController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('reconciliation')
  @RequirePermission('admin:read:audit_log')
  async reconciliation(@ZodQuery(ReconciliationQuerySchema) query: { limit: number }) {
    return this.ledger.reconciliationReport({ limit: query.limit });
  }

  @Get('aggregates')
  @RequirePermission('admin:read:audit_log')
  async aggregates(@ZodQuery(AggregatesQuerySchema) query: { days: number }) {
    return this.ledger.aggregates({ days: query.days });
  }
}
