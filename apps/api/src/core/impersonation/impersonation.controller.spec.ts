import '../../common/bigint-serialization';

import { ExecutionContext, ForbiddenException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { AdminConfirmGuard } from '../../common/guards/admin-confirm.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { ErrorCode } from '../../common/types/response.types';

import { ImpersonationController } from './impersonation.controller';
import { ImpersonationService } from './impersonation.service';

const ADMIN_USER_ID = 1n;
const TARGET_USER_ID = 5n;
const IMP_SESSION_ID = 42n;

interface BuildOpts {
  user?: { id: bigint };
  impersonation?: { actorUserId: bigint; impSessionId: bigint } | undefined;
  permissionDenied?: boolean;
  enforceAdminConfirm?: boolean;
}

async function buildApp(
  serviceMock: Partial<ImpersonationService>,
  opts: BuildOpts = {},
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ImpersonationController],
    providers: [{ provide: ImpersonationService, useValue: serviceMock }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate(ctx: ExecutionContext) {
        const req = ctx.switchToHttp().getRequest();
        req.user = opts.user ?? { id: ADMIN_USER_ID };
        if (opts.impersonation !== undefined) req.impersonation = opts.impersonation;
        return true;
      },
    })
    .overrideGuard(PermissionGuard)
    .useValue({
      canActivate: () => {
        if (opts.permissionDenied) throw new ForbiddenException();
        return true;
      },
    })
    .overrideGuard(AdminConfirmGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        if (!opts.enforceAdminConfirm) return true;
        const req = ctx.switchToHttp().getRequest();
        return req.headers['x-admin-confirm'] === 'true';
      },
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

describe('ImpersonationController (integration)', () => {
  describe('POST /admin/impersonation/start', () => {
    it('admin → returns new tokens and session id', async () => {
      const start = jest.fn().mockResolvedValue({
        impSessionId: IMP_SESSION_ID,
        tokens: {
          accessToken: 'imp.access',
          refreshToken: 'imp.refresh',
          sessionId: 99n,
          refreshCookie: { name: 'refresh_token', value: 'x', options: {} },
        },
      });
      const app = await buildApp({ start });

      const res = await request(app.getHttpServer())
        .post('/admin/impersonation/start')
        .send({ targetUserId: '5', reason: 'support ticket #1234' })
        .expect(200);

      expect(res.body.data).toMatchObject({
        impSessionId: '42',
        accessToken: 'imp.access',
        refreshToken: 'imp.refresh',
        targetUserId: '5',
      });
      expect(start).toHaveBeenCalledWith(
        ADMIN_USER_ID,
        TARGET_USER_ID,
        'support ticket #1234',
        null,
        expect.any(String),
      );
      await app.close();
    });

    it('rejects a reason shorter than 10 characters → 400', async () => {
      const start = jest.fn();
      const app = await buildApp({ start });

      const res = await request(app.getHttpServer())
        .post('/admin/impersonation/start')
        .send({ targetUserId: '5', reason: 'short' })
        .expect(400);

      expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(start).not.toHaveBeenCalled();
      await app.close();
    });

    it('rejects nested impersonation → 409 CANNOT_NEST_IMPERSONATION', async () => {
      const start = jest.fn();
      const app = await buildApp(
        { start },
        { impersonation: { actorUserId: ADMIN_USER_ID, impSessionId: IMP_SESSION_ID } },
      );

      const res = await request(app.getHttpServer())
        .post('/admin/impersonation/start')
        .send({ targetUserId: '5', reason: 'investigating issue' })
        .expect(409);

      expect(res.body.error.code).toBe(ErrorCode.CANNOT_NEST_IMPERSONATION);
      expect(start).not.toHaveBeenCalled();
      await app.close();
    });

    it('regular user without permission → 403', async () => {
      const start = jest.fn();
      const app = await buildApp({ start }, { permissionDenied: true });

      await request(app.getHttpServer())
        .post('/admin/impersonation/start')
        .send({ targetUserId: '5', reason: 'investigating issue' })
        .expect(403);

      expect(start).not.toHaveBeenCalled();
      await app.close();
    });

    it('admin without X-Admin-Confirm header → 403 (guard rejects)', async () => {
      const start = jest.fn();
      const app = await buildApp({ start }, { enforceAdminConfirm: true });

      await request(app.getHttpServer())
        .post('/admin/impersonation/start')
        .send({ targetUserId: '5', reason: 'investigating issue' })
        .expect(403);

      expect(start).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe('POST /admin/impersonation/stop', () => {
    it('with active impersonation context → ends the session', async () => {
      const stop = jest.fn().mockResolvedValue({
        id: IMP_SESSION_ID,
        endedAt: new Date('2026-05-01T00:00:00Z'),
      });
      const app = await buildApp(
        { stop },
        {
          user: { id: TARGET_USER_ID },
          impersonation: { actorUserId: ADMIN_USER_ID, impSessionId: IMP_SESSION_ID },
        },
      );

      const res = await request(app.getHttpServer()).post('/admin/impersonation/stop').expect(200);

      expect(res.body.data.impSessionId).toBe('42');
      expect(stop).toHaveBeenCalledWith(IMP_SESSION_ID, ADMIN_USER_ID);
      await app.close();
    });

    it('without impersonation context → 401 UNAUTHORIZED', async () => {
      const stop = jest.fn();
      const app = await buildApp({ stop });

      const res = await request(app.getHttpServer()).post('/admin/impersonation/stop').expect(401);

      expect(res.body.error.code).toBe(ErrorCode.UNAUTHORIZED);
      expect(stop).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe('GET /admin/impersonation/active', () => {
    it('returns the active impersonation when one exists', async () => {
      const findActive = jest.fn().mockResolvedValue({
        id: IMP_SESSION_ID,
        targetUserId: TARGET_USER_ID,
        startedAt: new Date('2026-05-01T00:00:00Z'),
        reason: 'investigating issue',
      });
      const app = await buildApp({ findActive });

      const res = await request(app.getHttpServer()).get('/admin/impersonation/active').expect(200);

      expect(res.body.data.active).toMatchObject({
        impSessionId: '42',
        targetUserId: '5',
      });
      expect(findActive).toHaveBeenCalledWith(ADMIN_USER_ID);
      await app.close();
    });

    it('returns { active: null } when there is no active session', async () => {
      const findActive = jest.fn().mockResolvedValue(null);
      const app = await buildApp({ findActive });

      const res = await request(app.getHttpServer()).get('/admin/impersonation/active').expect(200);

      expect(res.body.data).toEqual({ active: null });
      await app.close();
    });
  });
});
