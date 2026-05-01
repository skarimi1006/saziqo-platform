import '../../common/bigint-serialization';

import { ExecutionContext, ForbiddenException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { ErrorCode } from '../../common/types/response.types';

import { AuditController } from './audit.controller';
import { AuditLogWithActor, AuditService } from './audit.service';

const ADMIN_ID = 1n;
const REGULAR_USER_ID = 99n;

const grantedGuards = {
  jwt: {
    canActivate(ctx: ExecutionContext) {
      ctx.switchToHttp().getRequest().user = { id: ADMIN_ID };
      return true;
    },
  },
  permission: { canActivate: () => true },
};

const deniedGuards = {
  jwt: {
    canActivate(ctx: ExecutionContext) {
      ctx.switchToHttp().getRequest().user = { id: REGULAR_USER_ID };
      return true;
    },
  },
  permission: {
    canActivate: () => {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN,
        message: 'Insufficient permissions',
      });
    },
  },
};

function makeRow(id: bigint, overrides: Partial<AuditLogWithActor> = {}): AuditLogWithActor {
  return {
    id,
    actorUserId: ADMIN_ID,
    action: 'LOGIN_SUCCESS',
    resource: 'user',
    resourceId: '5',
    payloadHash: 'abc123',
    ipAddress: '127.0.0.1',
    userAgent: 'jest',
    createdAt: new Date('2026-01-15T10:00:00Z'),
    actor: {
      id: ADMIN_ID,
      firstName: 'علی',
      lastName: 'احمدی',
      phone: '+98****6789',
    },
    ...overrides,
  };
}

type ServiceMock = jest.Mocked<Pick<AuditService, 'findManyForAdmin' | 'findByIdForAdmin'>>;

async function buildApp(
  serviceMock: Partial<AuditService>,
  guards: typeof grantedGuards,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [AuditController],
    providers: [{ provide: AuditService, useValue: serviceMock }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(guards.jwt)
    .overrideGuard(PermissionGuard)
    .useValue(guards.permission)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

describe('AuditController', () => {
  let service: ServiceMock;
  let app: INestApplication;

  beforeEach(() => {
    service = {
      findManyForAdmin: jest.fn(),
      findByIdForAdmin: jest.fn(),
    };
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('GET /admin/audit', () => {
    it('returns 403 for a user without admin:read:audit_log permission', async () => {
      app = await buildApp(service, deniedGuards);

      const res = await request(app.getHttpServer()).get('/admin/audit').expect(403);
      expect(res.body.error.code).toBe(ErrorCode.FORBIDDEN);
      expect(service.findManyForAdmin).not.toHaveBeenCalled();
    });

    it('returns paginated audit logs with default limit 50', async () => {
      service.findManyForAdmin.mockResolvedValue({
        items: [makeRow(10n), makeRow(9n)],
        nextCursor: 9n,
        hasMore: true,
      });
      app = await buildApp(service, grantedGuards);

      const res = await request(app.getHttpServer()).get('/admin/audit').expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.pagination.limit).toBe(50);
      expect(res.body.meta.pagination.nextCursor).toBe('9');
      expect(res.body.meta.hasMore).toBe(true);
      expect(service.findManyForAdmin).toHaveBeenCalledWith(expect.objectContaining({}), {
        cursor: undefined,
        limit: 50,
      });
    });

    it('passes actorUserId filter as bigint', async () => {
      service.findManyForAdmin.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
      app = await buildApp(service, grantedGuards);

      await request(app.getHttpServer()).get('/admin/audit?actorUserId=7').expect(200);

      expect(service.findManyForAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: 7n }),
        expect.anything(),
      );
    });

    it('passes comma-separated action filter as-is for IN-clause splitting in service', async () => {
      service.findManyForAdmin.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
      app = await buildApp(service, grantedGuards);

      await request(app.getHttpServer())
        .get('/admin/audit?action=LOGIN_SUCCESS,LOGOUT')
        .expect(200);

      expect(service.findManyForAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LOGIN_SUCCESS,LOGOUT' }),
        expect.anything(),
      );
    });

    it('passes failed=true as boolean', async () => {
      service.findManyForAdmin.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
      app = await buildApp(service, grantedGuards);

      await request(app.getHttpServer()).get('/admin/audit?failed=true').expect(200);

      expect(service.findManyForAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ failed: true }),
        expect.anything(),
      );
    });

    it('passes cursor as bigint for pagination', async () => {
      service.findManyForAdmin.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
      app = await buildApp(service, grantedGuards);

      await request(app.getHttpServer()).get('/admin/audit?cursor=100&limit=10').expect(200);

      expect(service.findManyForAdmin).toHaveBeenCalledWith(expect.anything(), {
        cursor: 100n,
        limit: 10,
      });
    });

    it('returns 400 for limit out of range', async () => {
      app = await buildApp(service, grantedGuards);
      const res = await request(app.getHttpServer()).get('/admin/audit?limit=200').expect(400);
      expect(res.body.error).toBeDefined();
    });

    it('returns actor as null for soft-deleted actors', async () => {
      service.findManyForAdmin.mockResolvedValue({
        items: [makeRow(5n, { actor: null })],
        nextCursor: null,
        hasMore: false,
      });
      app = await buildApp(service, grantedGuards);

      const res = await request(app.getHttpServer()).get('/admin/audit').expect(200);
      expect(res.body.data[0].actor).toBeNull();
    });
  });

  describe('GET /admin/audit/:id', () => {
    it('returns 403 for a user without permission', async () => {
      app = await buildApp(service, deniedGuards);
      await request(app.getHttpServer()).get('/admin/audit/1').expect(403);
      expect(service.findByIdForAdmin).not.toHaveBeenCalled();
    });

    it('returns the audit log row with actor summary', async () => {
      const row = makeRow(42n);
      service.findByIdForAdmin.mockResolvedValue(row);
      app = await buildApp(service, grantedGuards);

      const res = await request(app.getHttpServer()).get('/admin/audit/42').expect(200);

      expect(service.findByIdForAdmin).toHaveBeenCalledWith(42n);
      expect(res.body.data.id).toBe('42');
      expect(res.body.data.actor.phone).toBe('+98****6789');
      expect(res.body.data.actor.id).toBe('1');
    });

    it('returns 404 when the row does not exist', async () => {
      service.findByIdForAdmin.mockResolvedValue(null);
      app = await buildApp(service, grantedGuards);

      const res = await request(app.getHttpServer()).get('/admin/audit/9999').expect(404);
      expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);
    });

    it('returns 404 for a non-numeric id', async () => {
      app = await buildApp(service, grantedGuards);
      const res = await request(app.getHttpServer()).get('/admin/audit/not-a-number').expect(404);
      expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);
    });
  });
});
