import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';

import { ErrorCode } from '../../common/types/response.types';
import { ConfigService } from '../../config/config.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../rbac/permissions.service';
import { RedisService } from '../redis/redis.service';
import { WalletsService } from '../wallets/wallets.service';

import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

type MockPrismaClient = {
  user: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  role: {
    findUnique: jest.Mock;
  };
};

const SUPER_ADMIN_PHONE = '+989100000000';

describe('UsersService', () => {
  let service: UsersService;
  let mockClient: MockPrismaClient;
  let readSpy: jest.Mock;
  let writeSpy: jest.Mock;
  let mockRedisClient: { del: jest.Mock };
  let mockPermissions: jest.Mocked<
    Pick<PermissionsService, 'userHasPermission' | 'assignRoleToUser' | 'removeRoleFromUser'>
  >;
  let mockConfig: { get: jest.Mock };
  let mockAudit: { log: jest.Mock };
  let mockNotifications: { dispatch: jest.Mock };
  let mockWallets: { findOrCreateForUser: jest.Mock };

  beforeEach(async () => {
    mockClient = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      role: {
        findUnique: jest.fn(),
      },
    };
    readSpy = jest.fn(() => mockClient);
    writeSpy = jest.fn(() => mockClient);

    mockRedisClient = { del: jest.fn().mockResolvedValue(1) };
    mockPermissions = {
      userHasPermission: jest.fn(),
      assignRoleToUser: jest.fn().mockResolvedValue(undefined),
      removeRoleFromUser: jest.fn().mockResolvedValue(undefined),
    };
    mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'SUPER_ADMIN_PHONE') return SUPER_ADMIN_PHONE;
        return undefined;
      }),
    };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    mockNotifications = {
      dispatch: jest.fn().mockResolvedValue({ dispatched: ['IN_APP'], failures: [] }),
    };
    mockWallets = {
      findOrCreateForUser: jest.fn().mockResolvedValue({ id: 1n, userId: 1n, balance: 0n }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: { read: readSpy, write: writeSpy } },
        { provide: RedisService, useValue: { getClient: () => mockRedisClient } },
        { provide: PermissionsService, useValue: mockPermissions },
        { provide: ConfigService, useValue: mockConfig },
        { provide: AuditService, useValue: mockAudit },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: WalletsService, useValue: mockWallets },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  // ── Existing read methods ────────────────────────────────────────────

  describe('findByPhone', () => {
    it('returns null when the phone is not registered', async () => {
      mockClient.user.findUnique.mockResolvedValue(null);
      const result = await service.findByPhone('+989000000000');
      expect(result).toBeNull();
      expect(readSpy).toHaveBeenCalledTimes(1);
      expect(writeSpy).not.toHaveBeenCalled();
      expect(mockClient.user.findUnique).toHaveBeenCalledWith({
        where: { phone: '+989000000000' },
      });
    });

    it('returns the matching user', async () => {
      const fake = { id: 7n, phone: '+989123456789', status: UserStatus.ACTIVE };
      mockClient.user.findUnique.mockResolvedValue(fake);
      const result = await service.findByPhone('+989123456789');
      expect(result).toBe(fake);
    });
  });

  describe('findById', () => {
    it('uses the read replica path', async () => {
      mockClient.user.findUnique.mockResolvedValue(null);
      await service.findById(42n);
      expect(readSpy).toHaveBeenCalled();
      expect(mockClient.user.findUnique).toHaveBeenCalledWith({ where: { id: 42n } });
    });
  });

  describe('create', () => {
    it('persists with PENDING_PROFILE status and uses write()', async () => {
      const created = { id: 1n, phone: '+989000000000', status: UserStatus.PENDING_PROFILE };
      mockClient.user.create.mockResolvedValue(created);

      const result = await service.create({ phone: '+989000000000' });

      expect(result).toBe(created);
      expect(writeSpy).toHaveBeenCalledTimes(1);
      expect(mockClient.user.create).toHaveBeenCalledWith({
        data: { phone: '+989000000000', status: UserStatus.PENDING_PROFILE },
      });
    });
  });

  describe('update', () => {
    it('forwards arbitrary update data through write()', async () => {
      mockClient.user.update.mockResolvedValue({ id: 1n });
      await service.update(1n, { firstName: 'علی' });
      expect(writeSpy).toHaveBeenCalled();
      expect(mockClient.user.update).toHaveBeenCalledWith({
        where: { id: 1n },
        data: { firstName: 'علی' },
      });
    });
  });

  describe('markPhoneVerified', () => {
    it('sets phoneVerifiedAt to a Date', async () => {
      mockClient.user.update.mockResolvedValue({ id: 1n });
      await service.markPhoneVerified(1n);

      const arg = mockClient.user.update.mock.calls[0]?.[0];
      expect(arg.where).toEqual({ id: 1n });
      expect(arg.data.phoneVerifiedAt).toBeInstanceOf(Date);
    });
  });

  describe('completeProfile', () => {
    it('promotes user to ACTIVE and sets profileCompletedAt', async () => {
      mockClient.user.update.mockResolvedValue({ id: 1n, status: UserStatus.ACTIVE });

      const dto = {
        firstName: 'علی',
        lastName: 'احمدی',
        nationalId: '0123456789',
        email: 'ali@example.com',
      };
      await service.completeProfile(1n, dto);

      const arg = mockClient.user.update.mock.calls[0]?.[0];
      expect(arg.where).toEqual({ id: 1n });
      expect(arg.data.firstName).toBe('علی');
      expect(arg.data.lastName).toBe('احمدی');
      expect(arg.data.nationalId).toBe('0123456789');
      expect(arg.data.email).toBe('ali@example.com');
      expect(arg.data.status).toBe(UserStatus.ACTIVE);
      expect(arg.data.profileCompletedAt).toBeInstanceOf(Date);
      // Email verification is a separate flow — must NOT be set here.
      expect(arg.data.emailVerifiedAt).toBeUndefined();
    });

    it('writes a PROFILE_COMPLETED audit entry whose payload includes the submitted fields', async () => {
      mockClient.user.update.mockResolvedValue({ id: 1n, status: UserStatus.ACTIVE });
      const dto = {
        firstName: 'علی',
        lastName: 'احمدی',
        nationalId: '0123456789',
        email: 'ali@example.com',
      };
      await service.completeProfile(1n, dto);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 1n,
          action: 'PROFILE_COMPLETED',
          resource: 'user',
          resourceId: 1n,
          payload: expect.objectContaining({
            firstName: 'علی',
            lastName: 'احمدی',
            // The audit *service* is what redacts/masks before persist; the
            // service-level call hands the raw values through and audit.log
            // owns redaction. Tested in audit.service.spec.ts + redaction.spec.ts.
            nationalId: '0123456789',
            email: 'ali@example.com',
          }),
        }),
      );
    });

    it('dispatches PROFILE_COMPLETED in-app notification after profile is saved', async () => {
      mockClient.user.update.mockResolvedValue({ id: 1n, status: UserStatus.ACTIVE });
      const dto = {
        firstName: 'علی',
        lastName: 'احمدی',
        nationalId: '0123456789',
        email: 'ali@example.com',
      };
      await service.completeProfile(1n, dto);

      expect(mockNotifications.dispatch).toHaveBeenCalledWith({
        userId: 1n,
        type: 'PROFILE_COMPLETED',
        payload: {},
        channels: ['IN_APP'],
      });
    });

    it('creates wallet for user on profile completion', async () => {
      mockClient.user.update.mockResolvedValue({ id: 1n, status: UserStatus.ACTIVE });
      const dto = {
        firstName: 'علی',
        lastName: 'احمدی',
        nationalId: '0123456789',
        email: 'ali@example.com',
      };
      await service.completeProfile(1n, dto);

      expect(mockWallets.findOrCreateForUser).toHaveBeenCalledWith(1n);
    });
  });

  describe('softDelete', () => {
    it('sets deletedAt and status DELETED via write()', async () => {
      mockClient.user.update.mockResolvedValue({ id: 1n, status: UserStatus.DELETED });
      await service.softDelete(1n);

      const arg = mockClient.user.update.mock.calls[0]?.[0];
      expect(arg.where).toEqual({ id: 1n });
      expect(arg.data.deletedAt).toBeInstanceOf(Date);
      expect(arg.data.status).toBe(UserStatus.DELETED);
      expect(writeSpy).toHaveBeenCalled();
    });
  });

  // ── Admin read methods ───────────────────────────────────────────────

  const makeUser = (id: bigint, overrides: Record<string, unknown> = {}) => ({
    id,
    phone: `+98912345${String(Number(id)).padStart(4, '0')}`,
    firstName: 'علی',
    lastName: 'احمدی',
    nationalId: '1234567890',
    email: `user${id}@example.com`,
    status: UserStatus.ACTIVE,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    profileCompletedAt: null,
    deletedAt: null,
    userRoles: [{ role: { id: 1n, name: 'user', persianName: 'کاربر' } }],
    sessions: [{ createdAt: new Date('2025-06-01') }],
    ...overrides,
  });

  describe('findManyForAdmin', () => {
    it('returns sanitized users with nationalId masked to last 4 digits', async () => {
      mockClient.user.findMany.mockResolvedValue([makeUser(1n)]);

      const result = await service.findManyForAdmin({}, { limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.nationalId).toBe('******7890');
      expect(result.items[0]!.phone).toBe('+989123450001');
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(readSpy).toHaveBeenCalled();
    });

    it('sets lastSeenAt from the most recent active session', async () => {
      const seenAt = new Date('2025-06-15');
      mockClient.user.findMany.mockResolvedValue([
        makeUser(1n, { sessions: [{ createdAt: seenAt }] }),
      ]);

      const result = await service.findManyForAdmin({}, { limit: 20 });

      expect(result.items[0]!.lastSeenAt).toEqual(seenAt);
    });

    it('sets lastSeenAt to null when no active sessions', async () => {
      mockClient.user.findMany.mockResolvedValue([makeUser(1n, { sessions: [] })]);

      const result = await service.findManyForAdmin({}, { limit: 20 });

      expect(result.items[0]!.lastSeenAt).toBeNull();
    });

    it('returns hasMore=true and nextCursor when results exceed limit', async () => {
      const users = Array.from({ length: 21 }, (_, i) => makeUser(BigInt(100 - i)));
      mockClient.user.findMany.mockResolvedValue(users);

      const result = await service.findManyForAdmin({}, { limit: 20 });

      expect(result.items).toHaveLength(20);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe(users[19]!.id);
    });

    it('returns hasMore=false when results fit within limit', async () => {
      mockClient.user.findMany.mockResolvedValue([makeUser(1n), makeUser(2n)]);

      const result = await service.findManyForAdmin({}, { limit: 20 });

      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('applies status filter', async () => {
      mockClient.user.findMany.mockResolvedValue([]);
      await service.findManyForAdmin({ status: UserStatus.SUSPENDED }, { limit: 20 });

      const arg = mockClient.user.findMany.mock.calls[0]![0];
      expect(arg.where.status).toBe(UserStatus.SUSPENDED);
    });

    it('applies search filter across firstName, lastName, and email', async () => {
      mockClient.user.findMany.mockResolvedValue([]);
      await service.findManyForAdmin({ search: 'علی' }, { limit: 20 });

      const arg = mockClient.user.findMany.mock.calls[0]![0];
      expect(arg.where.OR).toHaveLength(3);
      expect(arg.where.OR[0]).toMatchObject({
        firstName: { contains: 'علی', mode: 'insensitive' },
      });
    });

    it('applies phoneContains filter', async () => {
      mockClient.user.findMany.mockResolvedValue([]);
      await service.findManyForAdmin({ phoneContains: '0912' }, { limit: 20 });

      const arg = mockClient.user.findMany.mock.calls[0]![0];
      expect(arg.where.phone).toEqual({ contains: '0912' });
    });

    it('applies roleId filter', async () => {
      mockClient.user.findMany.mockResolvedValue([]);
      await service.findManyForAdmin({ roleId: 3n }, { limit: 20 });

      const arg = mockClient.user.findMany.mock.calls[0]![0];
      expect(arg.where.userRoles).toEqual({ some: { roleId: 3n } });
    });

    it('applies createdAfter and createdBefore filters', async () => {
      const after = new Date('2025-01-01');
      const before = new Date('2025-12-31');
      mockClient.user.findMany.mockResolvedValue([]);
      await service.findManyForAdmin({ createdAfter: after, createdBefore: before }, { limit: 20 });

      const arg = mockClient.user.findMany.mock.calls[0]![0];
      expect(arg.where.createdAt).toEqual({ gte: after, lte: before });
    });

    it('applies cursor for keyset pagination', async () => {
      mockClient.user.findMany.mockResolvedValue([]);
      await service.findManyForAdmin({}, { cursor: 50n, limit: 10 });

      const arg = mockClient.user.findMany.mock.calls[0]![0];
      expect(arg.where.id).toEqual({ lt: 50n });
    });

    it('requests take = limit + 1 to detect next page', async () => {
      mockClient.user.findMany.mockResolvedValue([]);
      await service.findManyForAdmin({}, { limit: 15 });

      const arg = mockClient.user.findMany.mock.calls[0]![0];
      expect(arg.take).toBe(16);
    });

    it('excludes totpSecret and betaFlags from the view', async () => {
      const user = makeUser(1n);
      (user as Record<string, unknown>).totpSecret = 'super-secret';
      (user as Record<string, unknown>).betaFlags = ['flag1'];
      mockClient.user.findMany.mockResolvedValue([user]);

      const result = await service.findManyForAdmin({}, { limit: 20 });

      expect(result.items[0]).not.toHaveProperty('totpSecret');
      expect(result.items[0]).not.toHaveProperty('betaFlags');
    });
  });

  describe('findByIdForAdmin', () => {
    it('returns null for an unknown id', async () => {
      mockClient.user.findUnique.mockResolvedValue(null);
      const result = await service.findByIdForAdmin(999n);
      expect(result).toBeNull();
    });

    it('returns sanitized view with roles and masked nationalId', async () => {
      const fakeUser = makeUser(5n, {
        nationalId: '9876543210',
        userRoles: [{ role: { id: 2n, name: 'admin', persianName: 'مدیر' } }],
      });
      mockClient.user.findUnique.mockResolvedValue(fakeUser);

      const result = await service.findByIdForAdmin(5n);

      expect(result).not.toBeNull();
      expect(result!.nationalId).toBe('******3210');
      expect(result!.roles).toHaveLength(1);
      expect(result!.roles[0]!.name).toBe('admin');
    });

    it('uses read path', async () => {
      mockClient.user.findUnique.mockResolvedValue(null);
      await service.findByIdForAdmin(1n);
      expect(readSpy).toHaveBeenCalled();
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  // ── Admin mutation methods ───────────────────────────────────────────

  describe('updateStatusByAdmin', () => {
    it('throws NOT_FOUND when user does not exist', async () => {
      mockClient.user.findUnique.mockResolvedValue(null);

      await expect(service.updateStatusByAdmin(1n, UserStatus.SUSPENDED, 99n)).rejects.toThrow(
        HttpException,
      );

      try {
        await service.updateStatusByAdmin(2n, UserStatus.SUSPENDED, 99n);
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(404);
        expect((e as HttpException).getResponse()).toMatchObject({
          code: ErrorCode.NOT_FOUND,
        });
      }
    });

    it('throws CONFLICT for an invalid status transition (DELETED → ACTIVE)', async () => {
      mockClient.user.findUnique.mockResolvedValue(makeUser(1n, { status: UserStatus.DELETED }));

      let thrown: unknown;
      try {
        await service.updateStatusByAdmin(1n, UserStatus.ACTIVE, 99n);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(HttpException);
      const err = thrown as HttpException;
      expect(err.getStatus()).toBe(409);
      expect((err.getResponse() as { code: string }).code).toBe(
        ErrorCode.INVALID_STATUS_TRANSITION,
      );
    });

    it('allows valid transition ACTIVE → SUSPENDED', async () => {
      const user = makeUser(1n, { status: UserStatus.ACTIVE });
      mockClient.user.findUnique.mockResolvedValue(user);
      mockClient.user.update.mockResolvedValue({ ...user, status: UserStatus.SUSPENDED });

      const result = await service.updateStatusByAdmin(1n, UserStatus.SUSPENDED, 99n);

      expect(result.status).toBe(UserStatus.SUSPENDED);
      expect(mockClient.user.update).toHaveBeenCalledWith({
        where: { id: 1n },
        data: { status: UserStatus.SUSPENDED },
      });
    });

    it('allows valid transition PENDING_PROFILE → ACTIVE', async () => {
      const user = makeUser(1n, { status: UserStatus.PENDING_PROFILE });
      mockClient.user.findUnique.mockResolvedValue(user);
      mockClient.user.update.mockResolvedValue({ ...user, status: UserStatus.ACTIVE });

      await service.updateStatusByAdmin(1n, UserStatus.ACTIVE, 99n);

      expect(mockClient.user.update).toHaveBeenCalledWith({
        where: { id: 1n },
        data: { status: UserStatus.ACTIVE },
      });
    });

    it('allows valid transition SUSPENDED → ACTIVE', async () => {
      const user = makeUser(1n, { status: UserStatus.SUSPENDED });
      mockClient.user.findUnique.mockResolvedValue(user);
      mockClient.user.update.mockResolvedValue({ ...user, status: UserStatus.ACTIVE });

      await service.updateStatusByAdmin(1n, UserStatus.ACTIVE, 99n);

      expect(mockClient.user.update).toHaveBeenCalled();
    });

    it('invalidates user:permissions and user:status cache after update', async () => {
      const user = makeUser(1n, { status: UserStatus.ACTIVE });
      mockClient.user.findUnique.mockResolvedValue(user);
      mockClient.user.update.mockResolvedValue(user);

      await service.updateStatusByAdmin(1n, UserStatus.SUSPENDED, 99n);

      expect(mockRedisClient.del).toHaveBeenCalledWith('user:permissions:1');
      expect(mockRedisClient.del).toHaveBeenCalledWith('user:status:1');
    });

    it('writes an ADMIN_USER_STATUS_CHANGED audit entry with from/to status', async () => {
      const user = makeUser(1n, { status: UserStatus.ACTIVE });
      mockClient.user.findUnique.mockResolvedValue(user);
      mockClient.user.update.mockResolvedValue(user);

      await service.updateStatusByAdmin(1n, UserStatus.SUSPENDED, 99n);

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 99n,
          action: 'ADMIN_USER_STATUS_CHANGED',
          resource: 'user',
          resourceId: 1n,
          payload: { from: UserStatus.ACTIVE, to: UserStatus.SUSPENDED },
        }),
      );
    });
  });

  describe('assignRoleByAdmin', () => {
    it('throws NOT_FOUND when user does not exist', async () => {
      mockClient.user.findUnique.mockResolvedValue(null);

      await expect(service.assignRoleByAdmin(1n, 2n, undefined, 99n)).rejects.toThrow(
        HttpException,
      );
    });

    it('delegates to permissionsService.assignRoleToUser', async () => {
      mockClient.user.findUnique.mockResolvedValue(makeUser(1n));

      await service.assignRoleByAdmin(1n, 2n, undefined, 99n);

      expect(mockPermissions.assignRoleToUser).toHaveBeenCalledWith(1n, 2n, undefined);
    });

    it('forwards scope to permissionsService', async () => {
      mockClient.user.findUnique.mockResolvedValue(makeUser(1n));
      const scope = { ownership: 'any' };

      await service.assignRoleByAdmin(1n, 2n, scope, 99n);

      expect(mockPermissions.assignRoleToUser).toHaveBeenCalledWith(1n, 2n, scope);
    });

    it('invalidates cache after role assignment', async () => {
      mockClient.user.findUnique.mockResolvedValue(makeUser(1n));

      await service.assignRoleByAdmin(1n, 2n, undefined, 99n);

      expect(mockRedisClient.del).toHaveBeenCalledWith('user:permissions:1');
      expect(mockRedisClient.del).toHaveBeenCalledWith('user:status:1');
    });
  });

  describe('removeRoleByAdmin', () => {
    it('throws NOT_FOUND when user does not exist', async () => {
      mockClient.user.findUnique.mockResolvedValue(null);

      await expect(service.removeRoleByAdmin(1n, 2n, 99n)).rejects.toThrow(HttpException);
    });

    it('removes the role via permissionsService', async () => {
      const user = makeUser(1n, { phone: '+989000000001' }); // not super_admin
      mockClient.user.findUnique.mockResolvedValue(user);

      await service.removeRoleByAdmin(1n, 2n, 99n);

      expect(mockPermissions.removeRoleFromUser).toHaveBeenCalledWith(1n, 2n);
    });

    it('invalidates cache after role removal', async () => {
      mockClient.user.findUnique.mockResolvedValue(makeUser(1n, { phone: '+989000000001' }));

      await service.removeRoleByAdmin(1n, 2n, 99n);

      expect(mockRedisClient.del).toHaveBeenCalledWith('user:permissions:1');
      expect(mockRedisClient.del).toHaveBeenCalledWith('user:status:1');
    });

    it('throws CANNOT_REMOVE_BOOTSTRAP_ADMIN when removing super_admin role from bootstrap user', async () => {
      // User whose phone matches SUPER_ADMIN_PHONE
      const bootstrapUser = makeUser(1n, { phone: SUPER_ADMIN_PHONE });
      mockClient.user.findUnique.mockResolvedValueOnce(bootstrapUser);
      mockClient.role.findUnique.mockResolvedValueOnce({ name: 'super_admin' });

      let thrown: unknown;
      try {
        await service.removeRoleByAdmin(1n, 99n, 100n);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(HttpException);
      const err = thrown as HttpException;
      expect(err.getStatus()).toBe(409);
      expect((err.getResponse() as { code: string }).code).toBe(
        ErrorCode.CANNOT_REMOVE_BOOTSTRAP_ADMIN,
      );
      expect(mockPermissions.removeRoleFromUser).not.toHaveBeenCalled();
    });

    it('allows removing a non-super_admin role from the bootstrap user', async () => {
      const bootstrapUser = makeUser(1n, { phone: SUPER_ADMIN_PHONE });
      mockClient.user.findUnique.mockResolvedValueOnce(bootstrapUser);
      mockClient.role.findUnique.mockResolvedValueOnce({ name: 'admin' }); // not super_admin

      await service.removeRoleByAdmin(1n, 99n, 100n);

      expect(mockPermissions.removeRoleFromUser).toHaveBeenCalledWith(1n, 99n);
    });

    it('allows removing any role from a non-bootstrap user', async () => {
      mockClient.user.findUnique.mockResolvedValue(makeUser(1n, { phone: '+989000000001' }));

      await service.removeRoleByAdmin(1n, 99n, 100n);

      expect(mockPermissions.removeRoleFromUser).toHaveBeenCalledWith(1n, 99n);
    });
  });
});
