import { createHash } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { canonicalJSONStringify } from './canonical-json';
import { redactSensitivePayload } from './redaction';

export interface AuditEntry {
  actorUserId: bigint | null;
  action: string;
  resource: string;
  resourceId: bigint | string | null;
  payload: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  // Set when the originating request was an admin impersonation. The audit
  // row's actor remains the admin; impersonationSessionId is stamped onto
  // the redacted payload so the admin shell can render "acting as" badges.
  impersonationSessionId?: bigint | undefined;
}

export interface AuditFilters {
  actorUserId?: bigint;
  action?: string;
  resource?: string;
  resourceId?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}

export interface AuditPagination {
  cursor?: bigint;
  limit: number;
}

export interface AuditPage {
  items: AuditLog[];
  nextCursor: bigint | null;
  hasMore: boolean;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // SECURITY: log() must NEVER throw to its caller — an audit-write failure
  // should not roll back the business action. We catch and log to the app
  // logger so monitoring picks it up, but the primary action proceeds.
  async log(entry: AuditEntry): Promise<void> {
    try {
      const redactedPayload = redactSensitivePayload(entry.payload) as Record<string, unknown>;
      const fullPayload =
        entry.impersonationSessionId !== undefined
          ? {
              ...redactedPayload,
              impersonationSessionId: String(entry.impersonationSessionId),
            }
          : redactedPayload;
      const payloadHash = createHash('sha256')
        .update(canonicalJSONStringify(fullPayload))
        .digest('hex');

      await this.prisma.auditLog.create({
        data: {
          actorUserId: entry.actorUserId,
          action: entry.action,
          resource: entry.resource,
          resourceId: entry.resourceId !== null ? String(entry.resourceId) : null,
          payloadHash,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log for ${entry.action} on ${entry.resource}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async findMany(filters: AuditFilters, pagination: AuditPagination): Promise<AuditPage> {
    const take = pagination.limit + 1;
    const where: Prisma.AuditLogWhereInput = {
      ...(filters.actorUserId !== undefined && { actorUserId: filters.actorUserId }),
      ...(filters.action && { action: filters.action }),
      ...(filters.resource && { resource: filters.resource }),
      ...(filters.resourceId && { resourceId: filters.resourceId }),
      ...((filters.createdAfter ?? filters.createdBefore) && {
        createdAt: {
          ...(filters.createdAfter && { gte: filters.createdAfter }),
          ...(filters.createdBefore && { lte: filters.createdBefore }),
        },
      }),
      ...(pagination.cursor !== undefined && { id: { lt: pagination.cursor } }),
    };

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take,
    });

    const hasMore = rows.length > pagination.limit;
    const items = hasMore ? rows.slice(0, pagination.limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? last.id : null;

    return { items, nextCursor, hasMore };
  }

  async findById(id: bigint): Promise<AuditLog | null> {
    return this.prisma.auditLog.findUnique({ where: { id } });
  }
}
