import { Injectable } from '@nestjs/common';
import { Prisma, User, UserStatus } from '@prisma/client';

import { CompleteProfileDto } from './dto/complete-profile.dto';
import { UsersRepository } from './users.repository';

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
}
