import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma, User, UserStatus } from '@prisma/client';

import { ErrorCode } from '../../common/types/response.types';
import { ConfigService } from '../../config/config.service';
import { AUDIT_ACTIONS } from '../audit/actions.catalog';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import { RedisService } from '../redis/redis.service';

import { CompleteProfileDto } from './dto/complete-profile.dto';
import { UsersRepository } from './users.repository';

// CLAUDE: Transitions that are legal in the admin context. DELETED is a
// terminal state — no transitions out. Phase 5D adds per-role guards.
const STATUS_TRANSITIONS: Record<UserStatus, UserStatus[]> = {
  [UserStatus.PENDING_PROFILE]: [UserStatus.ACTIVE, UserStatus.SUSPENDED, UserStatus.DELETED],
  [UserStatus.ACTIVE]: [UserStatus.SUSPENDED, UserStatus.DELETED],
  [UserStatus.SUSPENDED]: [UserStatus.ACTIVE, UserStatus.DELETED],
  [UserStatus.DELETED]: [],
};

export interface AdminUserFilters {
  status?: UserStatus | undefined;
  roleId?: bigint | undefined;
  phoneContains?: string | undefined;
  search?: string | undefined;
  createdAfter?: Date | undefined;
  createdBefore?: Date | undefined;
}

export interface AdminUserView {
  id: bigint;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  nationalId: string | null;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  profileCompletedAt: Date | null;
  deletedAt: Date | null;
  roles: Array<{ id: bigint; name: string; persianName: string }>;
  lastSeenAt: Date | null;
}

type UserWithDetails = {
  id: bigint;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  nationalId: string | null;
  email: string | null;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  profileCompletedAt: Date | null;
  deletedAt: Date | null;
  userRoles: Array<{ role: { id: bigint; name: string; persianName: string } }>;
  sessions: Array<{ createdAt: Date }>;
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly repo: UsersRepository,
    private readonly redis: RedisService,
    private readonly permissions: PermissionsService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  // ──────── Reads (use repo.read() for future read-replica support) ────────

  async findByPhone(phone: string): Promise<User | null> {
    return this.repo.read().user.findUnique({ where: { phone } });
  }

  async findById(id: bigint): Promise<User | null> {
    return this.repo.read().user.findUnique({ where: { id } });
  }

  async findManyForAdmin(
    filters: AdminUserFilters,
    pagination: { cursor?: bigint | undefined; limit: number },
  ): Promise<{ items: AdminUserView[]; nextCursor: bigint | null; hasMore: boolean }> {
    const take = pagination.limit + 1;

    const where: Prisma.UserWhereInput = {
      ...(filters.status !== undefined && { status: filters.status }),
      ...(filters.phoneContains && { phone: { contains: filters.phoneContains } }),
      ...(filters.search && {
        OR: [
          { firstName: { contains: filters.search, mode: 'insensitive' } },
          { lastName: { contains: filters.search, mode: 'insensitive' } },
          { email: { contains: filters.search, mode: 'insensitive' } },
        ],
      }),
      ...(filters.roleId !== undefined && {
        userRoles: { some: { roleId: filters.roleId } },
      }),
      ...((filters.createdAfter ?? filters.createdBefore) && {
        createdAt: {
          ...(filters.createdAfter && { gte: filters.createdAfter }),
          ...(filters.createdBefore && { lte: filters.createdBefore }),
        },
      }),
      ...(pagination.cursor !== undefined && { id: { lt: pagination.cursor } }),
    };

    const users = await this.repo.read().user.findMany({
      where,
      include: {
        userRoles: { include: { role: true } },
        sessions: {
          where: { revokedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { id: 'desc' },
      take,
    });

    const hasMore = users.length > pagination.limit;
    const items = (hasMore ? users.slice(0, pagination.limit) : users) as UserWithDetails[];
    const lastItem = items[items.length - 1];
    const nextCursor = hasMore && lastItem ? lastItem.id : null;

    return {
      items: items.map((u) => this.sanitizeForAdmin(u)),
      nextCursor,
      hasMore,
    };
  }

  async findByIdForAdmin(id: bigint): Promise<AdminUserView | null> {
    const user = await this.repo.read().user.findUnique({
      where: { id },
      include: {
        userRoles: { include: { role: true } },
        sessions: {
          where: { revokedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!user) return null;
    return this.sanitizeForAdmin(user as UserWithDetails);
  }

  // ──────── Writes (always primary DB via repo.write()) ────────

  async create(input: { phone: string }): Promise<User> {
    return this.repo.write().user.create({
      data: {
        phone: input.phone,
        status: UserStatus.PENDING_PROFILE,
      },
    });
  }

  async update(id: bigint, data: Prisma.UserUpdateInput): Promise<User> {
    return this.repo.write().user.update({ where: { id }, data });
  }

  async markPhoneVerified(id: bigint): Promise<User> {
    return this.repo.write().user.update({
      where: { id },
      data: { phoneVerifiedAt: new Date() },
    });
  }

  // SECURITY: Profile completion is the gate that turns a PENDING_PROFILE
  // user into ACTIVE. Email is recorded but emailVerifiedAt stays null —
  // email verification is a separate flow (deferred to v1.5 per the system plan).
  async completeProfile(id: bigint, dto: CompleteProfileDto): Promise<User> {
    const updated = await this.repo.write().user.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        nationalId: dto.nationalId,
        email: dto.email,
        status: UserStatus.ACTIVE,
        profileCompletedAt: new Date(),
      },
    });

    await this.audit.log({
      actorUserId: id,
      action: AUDIT_ACTIONS.PROFILE_COMPLETED,
      resource: 'user',
      resourceId: id,
      payload: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        // nationalId/email/phone are redacted by AuditService before persist
        nationalId: dto.nationalId,
        email: dto.email,
      },
      ipAddress: null,
      userAgent: null,
    });

    return updated;
  }

  // Soft delete — never hard delete users (audit log + ledger reference them).
  async softDelete(id: bigint): Promise<User> {
    return this.repo.write().user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: UserStatus.DELETED,
      },
    });
  }

  // ──────── Admin mutations ────────

  async updateStatusByAdmin(
    userId: bigint,
    newStatus: UserStatus,
    actorUserId: bigint,
  ): Promise<User> {
    const user = await this.repo.read().user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'User not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    const allowed = STATUS_TRANSITIONS[user.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new HttpException(
        {
          code: ErrorCode.INVALID_STATUS_TRANSITION,
          message: `Cannot transition from ${user.status} to ${newStatus}`,
        },
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.repo.write().user.update({
      where: { id: userId },
      data: { status: newStatus },
    });

    await this.invalidateUserCache(userId);

    await this.audit.log({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_USER_STATUS_CHANGED,
      resource: 'user',
      resourceId: userId,
      payload: {
        from: user.status,
        to: newStatus,
      },
      ipAddress: null,
      userAgent: null,
    });

    return updated;
  }

  async assignRoleByAdmin(
    userId: bigint,
    roleId: bigint,
    scope: Record<string, unknown> | undefined,
    actorUserId: bigint,
  ): Promise<void> {
    const user = await this.repo.read().user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'User not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    await this.permissions.assignRoleToUser(userId, roleId, scope);
    await this.invalidateUserCache(userId);

    // CLAUDE: Placeholder — replaced by AuditService in Phase 6B.
    this.logger.log(
      JSON.stringify({
        event: 'ADMIN_ROLE_ASSIGNED',
        actorUserId: String(actorUserId),
        targetUserId: String(userId),
        roleId: String(roleId),
      }),
    );
  }

  // SECURITY: The bootstrap super_admin cannot have their super_admin role removed.
  // This prevents accidental lock-out of the platform. Other admins can still
  // be demoted — only the user whose phone matches SUPER_ADMIN_PHONE is protected.
  async removeRoleByAdmin(userId: bigint, roleId: bigint, actorUserId: bigint): Promise<void> {
    const user = await this.repo.read().user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'User not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    const superAdminPhone = this.config.get('SUPER_ADMIN_PHONE');
    if (user.phone === superAdminPhone) {
      const role = await this.repo.read().role.findUnique({
        where: { id: roleId },
        select: { name: true },
      });
      if (role?.name === 'super_admin') {
        throw new HttpException(
          {
            code: ErrorCode.CANNOT_REMOVE_BOOTSTRAP_ADMIN,
            message: 'Cannot remove the super_admin role from the bootstrap admin user',
          },
          HttpStatus.CONFLICT,
        );
      }
    }

    await this.permissions.removeRoleFromUser(userId, roleId);
    await this.invalidateUserCache(userId);

    // CLAUDE: Placeholder — replaced by AuditService in Phase 6B.
    this.logger.log(
      JSON.stringify({
        event: 'ADMIN_ROLE_REMOVED',
        actorUserId: String(actorUserId),
        targetUserId: String(userId),
        roleId: String(roleId),
      }),
    );
  }

  // ──────── Private helpers ────────

  private async invalidateUserCache(userId: bigint): Promise<void> {
    const client = this.redis.getClient();
    await Promise.all([
      client.del(`user:permissions:${userId}`),
      client.del(`user:status:${userId}`),
    ]);
  }

  // SECURITY: nationalId is masked to expose only the last 4 digits.
  // Phone is shown in full in admin context — admins need it for support.
  // totpSecret and betaFlags are never exposed via this view.
  private sanitizeForAdmin(user: UserWithDetails): AdminUserView {
    return {
      id: user.id,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      nationalId: user.nationalId ? `******${user.nationalId.slice(-4)}` : null,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      profileCompletedAt: user.profileCompletedAt,
      deletedAt: user.deletedAt,
      roles: user.userRoles.map((ur) => ({
        id: ur.role.id,
        name: ur.role.name,
        persianName: ur.role.persianName,
      })),
      lastSeenAt: user.sessions[0]?.createdAt ?? null,
    };
  }
}
