import { Test } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';

import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

// Mock Prisma client surface — only the methods UsersService actually calls.
type MockPrismaClient = {
  user: {
    findUnique: jest.Mock;
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
});
