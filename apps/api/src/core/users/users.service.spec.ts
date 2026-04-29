import { Test } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';

import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

type MockPrismaClient = {
  user: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
};

describe('UsersService', () => {
  let service: UsersService;
  let mockClient: MockPrismaClient;
  let readSpy: jest.Mock;
  let writeSpy: jest.Mock;

  beforeEach(async () => {
    mockClient = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    readSpy = jest.fn(() => mockClient);
    writeSpy = jest.fn(() => mockClient);

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: UsersRepository,
          useValue: { read: readSpy, write: writeSpy },
        },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

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

  // ── Admin methods ────────────────────────────────────────────────────

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
      expect(arg.where.OR[1]).toMatchObject({
        lastName: { contains: 'علی', mode: 'insensitive' },
      });
      expect(arg.where.OR[2]).toMatchObject({
        email: { contains: 'علی', mode: 'insensitive' },
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
      // cast to any to attach fields that would be on the DB model but not our type
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
});
