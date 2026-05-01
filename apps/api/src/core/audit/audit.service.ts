import { createHash } from 'crypto';

import { Injectable, Logger } from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { canonicalJSONStringify } from './canonical-json';
import { maskPhone, redactSensitivePayload } from './redaction';

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
  // Denormalized flag so the admin viewer can filter failed actions without
  // scanning the payload (which is only stored as a hash).
  failed?: boolean;
}

export interface AuditFilters {
  actorUserId?: bigint;
  action?: string;
  resource?: string;
  resourceId?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}

// Filters for admin viewer — extends base with failed flag and date range.
export interface AuditAdminFilters {
  actorUserId?: bigint;
  // Comma-separated list maps to an IN clause (e.g. "LOGIN_SUCCESS,LOGOUT").
  action?: string;
  resource?: string;
  resourceId?: string;
  failed?: boolean;
  dateFrom?: Date;
  dateTo?: Date;
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

// SECURITY: Actor object in admin responses never exposes nationalId or email.
// Phone is always masked. Soft-deleted actors return null to avoid leaking
// deleted-user metadata while still preserving actorUserId on the audit row.
export interface AuditActorSummary {
  id: bigint;
  firstName: string | null;
  lastName: string | null;
  phone: string;
}

export type AuditLogWithActor = AuditLog & { actor: AuditActorSummary | null };

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
          failed: entry.failed ?? false,
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

  async findManyForAdmin(
    filters: AuditAdminFilters,
    pagination: AuditPagination,
  ): Promise<{ items: AuditLogWithActor[]; nextCursor: bigint | null; hasMore: boolean }> {
    const take = pagination.limit + 1;

    const actionFilter: Prisma.AuditLogWhereInput | undefined =
      filters.action !== undefined
        ? { action: { in: filters.action.split(',').map((a) => a.trim()) } }
        : undefined;

    const where: Prisma.AuditLogWhereInput = {
      ...(filters.actorUserId !== undefined && { actorUserId: filters.actorUserId }),
      ...actionFilter,
      ...(filters.resource && { resource: filters.resource }),
      ...(filters.resourceId && { resourceId: filters.resourceId }),
      ...(filters.failed !== undefined && { failed: filters.failed }),
      ...((filters.dateFrom ?? filters.dateTo) && {
        createdAt: {
          ...(filters.dateFrom && { gte: filters.dateFrom }),
          ...(filters.dateTo && { lte: filters.dateTo }),
        },
      }),
      ...(pagination.cursor !== undefined && { id: { lt: pagination.cursor } }),
    };

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take,
      include: {
        actor: {
          select: { id: true, firstName: true, lastName: true, phone: true, deletedAt: true },
        },
      },
    });

    const hasMore = rows.length > pagination.limit;
    const rawItems = hasMore ? rows.slice(0, pagination.limit) : rows;

    const items: AuditLogWithActor[] = rawItems.map((row) => {
      const { actor, ...log } = row;
      return {
        ...log,
        actor: actor === null || actor.deletedAt !== null ? null : this.sanitizeActor(actor),
      };
    });

    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? last.id : null;

    return { items, nextCursor, hasMore };
  }

  async findByIdForAdmin(id: bigint): Promise<AuditLogWithActor | null> {
    const row = await this.prisma.auditLog.findUnique({
      where: { id },
      include: {
        actor: {
          select: { id: true, firstName: true, lastName: true, phone: true, deletedAt: true },
        },
      },
    });
    if (!row) return null;
    const { actor, ...log } = row;
    return {
      ...log,
      actor: actor === null || actor.deletedAt !== null ? null : this.sanitizeActor(actor),
    };
  }

  private sanitizeActor(actor: {
    id: bigint;
    firstName: string | null;
    lastName: string | null;
    phone: string;
    deletedAt: Date | null;
  }): AuditActorSummary {
    return {
      id: actor.id,
      firstName: actor.firstName,
      lastName: actor.lastName,
      phone: maskPhone(actor.phone),
    };
  }
}
