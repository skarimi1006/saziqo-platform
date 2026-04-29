import { Injectable } from '@nestjs/common';
import { Prisma, User, UserStatus } from '@prisma/client';

import { CompleteProfileDto } from './dto/complete-profile.dto';
import { UsersRepository } from './users.repository';

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
  constructor(private readonly repo: UsersRepository) {}

  // Reads — go through repo.read() so a future read replica picks them up.

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

  // Writes — go through repo.write(). Always primary DB.

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
    return this.repo.write().user.update({
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

  // ──────── private helpers ────────

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
