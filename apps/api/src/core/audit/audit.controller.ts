import { Controller, Get, HttpException, HttpStatus, Param, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodQuery } from '../../common/decorators/zod-query.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ErrorCode } from '../../common/types/response.types';

import { AuditService } from './audit.service';

const AdminListAuditSchema = z.object({
  actorUserId: z.coerce.bigint().optional(),
  action: z.string().optional(),
  resource: z.string().optional(),
  resourceId: z.string().optional(),
  failed: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  cursor: z.coerce.bigint().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});

type AdminListAuditDto = z.infer<typeof AdminListAuditSchema>;

@Controller('admin/audit')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermission('admin:read:audit_log')
  async listAuditLogs(@ZodQuery(AdminListAuditSchema) query: AdminListAuditDto) {
    const { actorUserId, action, resource, resourceId, failed, dateFrom, dateTo, cursor, limit } =
      query;

    const result = await this.auditService.findManyForAdmin(
      { actorUserId, action, resource, resourceId, failed, dateFrom, dateTo },
      { cursor, limit },
    );

    return {
      data: result.items,
      meta: {
        pagination: {
          nextCursor: result.nextCursor?.toString() ?? undefined,
          limit,
        },
        hasMore: result.hasMore,
      },
    };
  }

  @Get(':id')
  @RequirePermission('admin:read:audit_log')
  async getAuditLog(@Param('id') id: string) {
    const parsed = this.parseId(id);
    const row = await this.auditService.findByIdForAdmin(parsed);
    if (!row) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Audit log entry not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return row;
  }

  private parseId(raw: string): bigint {
    try {
      return BigInt(raw);
    } catch {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Audit log entry not found' },
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
