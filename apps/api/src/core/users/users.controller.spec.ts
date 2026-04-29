import '../../common/bigint-serialization';

import { ExecutionContext, ForbiddenException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import request from 'supertest';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';

import { UsersController } from './users.controller';
import { AdminUserView, UsersService  } from './users.service';

const ADMIN_USER_ID = 1n;

// Guard that authenticates every request as ADMIN_USER_ID.
const grantedGuards = {
  jwt: {
    canActivate(ctx: ExecutionContext) {
      ctx.switchToHttp().getRequest().user = { id: ADMIN_USER_ID };
      return true;
    },
  },
  permission: { canActivate: () => true },
};

// Guard that throws 403 — simulates a user lacking the required permission.
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
  let serviceMock: jest.Mocked<Pick<UsersService, 'findManyForAdmin' | 'findByIdForAdmin'>>;

  beforeAll(async () => {
    serviceMock = {
      findManyForAdmin: jest.fn().mockResolvedValue({
        items: [makeAdminView(1n)],
        nextCursor: null,
        hasMore: false,
      }),
      findByIdForAdmin: jest.fn().mockResolvedValue(makeAdminView(1n)),
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
});
