import '../../common/bigint-serialization';

import {
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import request from 'supertest';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { ErrorCode } from '../../common/types/response.types';

import { UsersController } from './users.controller';
import { AdminUserView, UsersService } from './users.service';

const ADMIN_USER_ID = 1n;

const grantedGuards = {
  jwt: {
    canActivate(ctx: ExecutionContext) {
      ctx.switchToHttp().getRequest().user = { id: ADMIN_USER_ID };
      return true;
    },
  },
  permission: { canActivate: () => true },
};

const deniedGuards = {
  jwt: {
    canActivate(ctx: ExecutionContext) {
      ctx.switchToHttp().getRequest().user = { id: 99n };
      return true;
    },
  },
  permission: {
    canActivate: () => {
      throw new ForbiddenException();
    },
  },
};

const makeAdminView = (id: bigint): AdminUserView => ({
  id,
  phone: '+989123456789',
  firstName: 'علی',
  lastName: 'احمدی',
  email: 'ali@example.com',
  nationalId: '******7890',
  status: UserStatus.ACTIVE,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  profileCompletedAt: null,
  deletedAt: null,
  roles: [{ id: 1n, name: 'admin', persianName: 'مدیر' }],
  lastSeenAt: new Date('2025-06-01'),
});

type ServiceMock = jest.Mocked<
  Pick<
    UsersService,
    | 'findManyForAdmin'
    | 'findByIdForAdmin'
    | 'updateStatusByAdmin'
    | 'update'
    | 'assignRoleByAdmin'
    | 'removeRoleByAdmin'
  >
>;

async function buildApp(
  serviceMock: Partial<UsersService>,
  guards: typeof grantedGuards,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [UsersController],
    providers: [{ provide: UsersService, useValue: serviceMock }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(guards.jwt)
    .overrideGuard(PermissionGuard)
    .useValue(guards.permission)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalInterceptors(new ResponseInterceptor());
  await app.init();
  return app;
}

describe('UsersController (integration)', () => {
  let adminApp: INestApplication;
  let regularApp: INestApplication;
  let serviceMock: ServiceMock;

  beforeAll(async () => {
    serviceMock = {
      findManyForAdmin: jest.fn().mockResolvedValue({
        items: [makeAdminView(1n)],
        nextCursor: null,
        hasMore: false,
      }),
      findByIdForAdmin: jest.fn().mockResolvedValue(makeAdminView(1n)),
      updateStatusByAdmin: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      assignRoleByAdmin: jest.fn().mockResolvedValue(undefined),
      removeRoleByAdmin: jest.fn().mockResolvedValue(undefined),
    };

    [adminApp, regularApp] = await Promise.all([
      buildApp(serviceMock, grantedGuards),
      buildApp(serviceMock, deniedGuards),
    ]);
  });

  afterAll(async () => {
    await Promise.all([adminApp.close(), regularApp.close()]);
  });

  describe('GET /admin/users', () => {
    it('admin user → 200 with paginated list', async () => {
      const res = await request(adminApp.getHttpServer()).get('/admin/users').expect(200);

      expect(res.body).toMatchObject({
        data: expect.any(Array),
        meta: expect.objectContaining({
          pagination: expect.objectContaining({ limit: 20 }),
        }),
      });
      expect(res.body.data).toHaveLength(1);
    });

    it('regular user → 403', async () => {
      await request(regularApp.getHttpServer()).get('/admin/users').expect(403);
    });

    it('passes query filters to the service', async () => {
      serviceMock.findManyForAdmin.mockClear();
      serviceMock.findManyForAdmin.mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        hasMore: false,
      });

      await request(adminApp.getHttpServer())
        .get('/admin/users?status=ACTIVE&limit=10&cursor=50')
        .expect(200);

      expect(serviceMock.findManyForAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ status: UserStatus.ACTIVE }),
        expect.objectContaining({ limit: 10, cursor: 50n }),
      );
    });

    it('returns meta.hasMore and nextCursor when there is a next page', async () => {
      serviceMock.findManyForAdmin.mockResolvedValueOnce({
        items: [makeAdminView(100n)],
        nextCursor: 100n,
        hasMore: true,
      });

      const res = await request(adminApp.getHttpServer()).get('/admin/users').expect(200);

      expect(res.body.meta.hasMore).toBe(true);
      expect(res.body.meta.pagination.nextCursor).toBe('100');
    });
  });

  describe('GET /admin/users/:id', () => {
    it('admin user → 200 with user detail', async () => {
      serviceMock.findByIdForAdmin.mockResolvedValueOnce(makeAdminView(1n));

      const res = await request(adminApp.getHttpServer()).get('/admin/users/1').expect(200);

      expect(res.body).toMatchObject({
        data: expect.objectContaining({
          phone: '+989123456789',
          nationalId: '******7890',
        }),
      });
    });

    it('regular user → 403', async () => {
      await request(regularApp.getHttpServer()).get('/admin/users/1').expect(403);
    });

    it('returns 404 when the user does not exist', async () => {
      serviceMock.findByIdForAdmin.mockResolvedValueOnce(null);

      await request(adminApp.getHttpServer()).get('/admin/users/99999').expect(404);
    });

    it('returns 404 for a non-numeric id', async () => {
      await request(adminApp.getHttpServer()).get('/admin/users/not-a-number').expect(404);
    });
  });

  describe('PATCH /admin/users/:id', () => {
    beforeEach(() => {
      serviceMock.updateStatusByAdmin.mockClear();
      serviceMock.update.mockClear();
      serviceMock.findByIdForAdmin.mockResolvedValue(makeAdminView(1n));
    });

    it('regular user → 403', async () => {
      await request(regularApp.getHttpServer())
        .patch('/admin/users/1')
        .send({ status: UserStatus.SUSPENDED })
        .expect(403);
    });

    it('updates status and returns updated user', async () => {
      const updated = { ...makeAdminView(1n), status: UserStatus.SUSPENDED };
      serviceMock.findByIdForAdmin.mockResolvedValueOnce(updated);

      const res = await request(adminApp.getHttpServer())
        .patch('/admin/users/1')
        .send({ status: UserStatus.SUSPENDED })
        .expect(200);

      expect(serviceMock.updateStatusByAdmin).toHaveBeenCalledWith(
        1n,
        UserStatus.SUSPENDED,
        ADMIN_USER_ID,
      );
      expect(serviceMock.update).not.toHaveBeenCalled();
      expect(res.body.data.status).toBe(UserStatus.SUSPENDED);
    });

    it('updates profile fields and returns updated user', async () => {
      const updated = { ...makeAdminView(1n), firstName: 'رضا', email: 'reza@example.com' };
      serviceMock.findByIdForAdmin.mockResolvedValueOnce(updated);

      const res = await request(adminApp.getHttpServer())
        .patch('/admin/users/1')
        .send({ firstName: 'رضا', email: 'reza@example.com' })
        .expect(200);

      expect(serviceMock.updateStatusByAdmin).not.toHaveBeenCalled();
      expect(serviceMock.update).toHaveBeenCalledWith(
        1n,
        expect.objectContaining({ firstName: 'رضا', email: 'reza@example.com' }),
      );
      expect(res.body.data.firstName).toBe('رضا');
    });

    it('updates both status and profile fields in one request', async () => {
      await request(adminApp.getHttpServer())
        .patch('/admin/users/1')
        .send({ status: UserStatus.SUSPENDED, lastName: 'محمدی' })
        .expect(200);

      expect(serviceMock.updateStatusByAdmin).toHaveBeenCalledWith(
        1n,
        UserStatus.SUSPENDED,
        ADMIN_USER_ID,
      );
      expect(serviceMock.update).toHaveBeenCalledWith(
        1n,
        expect.objectContaining({ lastName: 'محمدی' }),
      );
    });

    it('propagates 409 CONFLICT from invalid status transition', async () => {
      serviceMock.updateStatusByAdmin.mockRejectedValueOnce(
        new HttpException(
          { code: ErrorCode.INVALID_STATUS_TRANSITION, message: 'Cannot transition' },
          HttpStatus.CONFLICT,
        ),
      );

      await request(adminApp.getHttpServer())
        .patch('/admin/users/1')
        .send({ status: UserStatus.ACTIVE })
        .expect(409);
    });

    it('returns 404 for non-numeric id', async () => {
      await request(adminApp.getHttpServer())
        .patch('/admin/users/abc')
        .send({ status: UserStatus.ACTIVE })
        .expect(404);
    });

    it('returns 404 when updated user is not found after mutation', async () => {
      serviceMock.findByIdForAdmin.mockResolvedValueOnce(null);

      await request(adminApp.getHttpServer())
        .patch('/admin/users/1')
        .send({ status: UserStatus.SUSPENDED })
        .expect(404);
    });
  });

  describe('POST /admin/users/:id/roles', () => {
    beforeEach(() => {
      serviceMock.assignRoleByAdmin.mockClear();
      serviceMock.findByIdForAdmin.mockResolvedValue(makeAdminView(1n));
    });

    it('regular user → 403', async () => {
      await request(regularApp.getHttpServer())
        .post('/admin/users/1/roles')
        .send({ roleId: '2' })
        .expect(403);
    });

    it('assigns role and returns updated user', async () => {
      const updated = {
        ...makeAdminView(1n),
        roles: [
          { id: 1n, name: 'admin', persianName: 'مدیر' },
          { id: 2n, name: 'editor', persianName: 'ویراستار' },
        ],
      };
      serviceMock.findByIdForAdmin.mockResolvedValueOnce(updated);

      const res = await request(adminApp.getHttpServer())
        .post('/admin/users/1/roles')
        .send({ roleId: '2' })
        .expect(200);

      expect(serviceMock.assignRoleByAdmin).toHaveBeenCalledWith(1n, 2n, undefined, ADMIN_USER_ID);
      expect(res.body.data.roles).toHaveLength(2);
    });

    it('forwards optional scope to the service', async () => {
      await request(adminApp.getHttpServer())
        .post('/admin/users/1/roles')
        .send({ roleId: '3', scope: { shopId: 42 } })
        .expect(200);

      expect(serviceMock.assignRoleByAdmin).toHaveBeenCalledWith(
        1n,
        3n,
        { shopId: 42 },
        ADMIN_USER_ID,
      );
    });

    it('returns 404 for non-numeric user id', async () => {
      await request(adminApp.getHttpServer())
        .post('/admin/users/abc/roles')
        .send({ roleId: '2' })
        .expect(404);
    });

    it('returns 404 when user is not found after assign', async () => {
      serviceMock.findByIdForAdmin.mockResolvedValueOnce(null);

      await request(adminApp.getHttpServer())
        .post('/admin/users/1/roles')
        .send({ roleId: '2' })
        .expect(404);
    });
  });

  describe('DELETE /admin/users/:id/roles/:roleId', () => {
    beforeEach(() => {
      serviceMock.removeRoleByAdmin.mockClear();
      serviceMock.findByIdForAdmin.mockResolvedValue(makeAdminView(1n));
    });

    it('regular user → 403', async () => {
      await request(regularApp.getHttpServer()).delete('/admin/users/1/roles/1').expect(403);
    });

    it('removes role and returns updated user', async () => {
      const updated = { ...makeAdminView(1n), roles: [] };
      serviceMock.findByIdForAdmin.mockResolvedValueOnce(updated);

      const res = await request(adminApp.getHttpServer())
        .delete('/admin/users/1/roles/1')
        .expect(200);

      expect(serviceMock.removeRoleByAdmin).toHaveBeenCalledWith(1n, 1n, ADMIN_USER_ID);
      expect(res.body.data.roles).toHaveLength(0);
    });

    it('propagates 409 CONFLICT when removing super_admin from bootstrap admin', async () => {
      serviceMock.removeRoleByAdmin.mockRejectedValueOnce(
        new HttpException(
          {
            code: ErrorCode.CANNOT_REMOVE_BOOTSTRAP_ADMIN,
            message: 'Cannot remove the super_admin role from the bootstrap admin user',
          },
          HttpStatus.CONFLICT,
        ),
      );

      const res = await request(adminApp.getHttpServer())
        .delete('/admin/users/1/roles/1')
        .expect(409);

      expect(res.body.code).toBe(ErrorCode.CANNOT_REMOVE_BOOTSTRAP_ADMIN);
    });

    it('returns 404 for non-numeric user id', async () => {
      await request(adminApp.getHttpServer()).delete('/admin/users/abc/roles/1').expect(404);
    });

    it('returns 404 for non-numeric role id', async () => {
      await request(adminApp.getHttpServer()).delete('/admin/users/1/roles/abc').expect(404);
    });

    it('returns 404 when user is not found after removal', async () => {
      serviceMock.findByIdForAdmin.mockResolvedValueOnce(null);

      await request(adminApp.getHttpServer()).delete('/admin/users/1/roles/1').expect(404);
    });
  });
});
