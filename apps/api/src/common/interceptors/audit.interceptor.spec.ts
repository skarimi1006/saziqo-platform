import '../bigint-serialization';

import {
  Body,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  INestApplication,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuditService } from '../../core/audit/audit.service';
import { Audit } from '../decorators/audit.decorator';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

import { AuditInterceptor } from './audit.interceptor';
import { ResponseInterceptor } from './response.interceptor';

const ACTOR_ID = 1n;
const ADMIN_ID = 2n;
const TARGET_ID = 5n;

@Controller('test')
@UseGuards(JwtAuthGuard)
class TestController {
  @Patch('users/:id')
  @Audit({ action: 'TEST_USER_PATCH', resource: 'user', resourceIdParam: 'id' })
  patchUser(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return { id, applied: body };
  }

  @Post('users/:id/fail')
  @Audit({ action: 'TEST_USER_FAIL', resource: 'user', resourceIdParam: 'id' })
  @HttpCode(HttpStatus.OK)
  failUser(@Param('id') _id: string) {
    throw new HttpException({ code: 'CONFLICT', message: 'cannot do that' }, HttpStatus.CONFLICT);
  }

  @Post('imp/start')
  @HttpCode(HttpStatus.OK)
  @Audit({
    action: 'TEST_IMP_START',
    resource: 'user',
    resourceIdParam: 'targetUserId',
    resourceIdSource: 'body',
  })
  startImp(@Body() body: { targetUserId: string }) {
    return { ok: true, targetUserId: body.targetUserId };
  }

  @Post('imp/stop')
  @HttpCode(HttpStatus.OK)
  @Audit({
    action: 'TEST_IMP_STOP',
    resource: 'user',
    resourceIdParam: 'impSessionId',
    resourceIdSource: 'response',
  })
  stopImp() {
    return { impSessionId: '42' };
  }

  @Get('untracked')
  untracked() {
    return { ok: true };
  }
}

interface BuildOpts {
  user?: { id: bigint };
  impersonation?: { actorUserId: bigint; impSessionId: bigint };
}

async function buildApp(
  audit: Pick<AuditService, 'log'>,
  opts: BuildOpts = {},
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [TestController],
    providers: [
      { provide: AuditService, useValue: audit },
      { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate(ctx: ExecutionContext) {
        const req = ctx.switchToHttp().getRequest();
        req.user = opts.user ?? { id: ACTOR_ID };
        if (opts.impersonation) req.impersonation = opts.impersonation;
        return true;
      },
    })
    .compile();

  const app = moduleRef.createNestApplication();
  // ResponseInterceptor must run inside AuditInterceptor (Phase 6B order:
  // audit outermost), but since this test only registers AuditInterceptor
  // via APP_INTERCEPTOR, useGlobalInterceptors here adds ResponseInterceptor
  // INNER to it, matching production layout.
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

describe('AuditInterceptor', () => {
  let audit: { log: jest.Mock };
  let app: INestApplication;

  beforeEach(() => {
    audit = { log: jest.fn().mockResolvedValue(undefined) };
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('writes an audit row on successful endpoint with resourceId from path param', async () => {
    app = await buildApp(audit);

    await request(app.getHttpServer())
      .patch('/test/users/77')
      .send({ status: 'ACTIVE' })
      .expect(200);

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TEST_USER_PATCH',
        resource: 'user',
        resourceId: 77n,
        actorUserId: ACTOR_ID,
        payload: expect.objectContaining({
          request: expect.objectContaining({
            method: 'PATCH',
            body: { status: 'ACTIVE' },
          }),
          response: expect.anything(),
        }),
      }),
    );
  });

  it('writes an audit row with failed: true and the error code on a 4xx', async () => {
    app = await buildApp(audit);

    await request(app.getHttpServer()).post('/test/users/77/fail').expect(409);

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TEST_USER_FAIL',
        resourceId: 77n,
        payload: expect.objectContaining({
          failed: true,
          statusCode: 409,
          errorCode: 'CONFLICT',
        }),
      }),
    );
  });

  it('extracts resourceId from request body when source is body', async () => {
    app = await buildApp(audit);

    await request(app.getHttpServer())
      .post('/test/imp/start')
      .send({ targetUserId: '5' })
      .expect(200);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TEST_IMP_START',
        resourceId: 5n,
      }),
    );
  });

  it('extracts resourceId from handler response when source is response', async () => {
    app = await buildApp(audit);

    await request(app.getHttpServer()).post('/test/imp/stop').expect(200);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TEST_IMP_STOP',
        resourceId: 42n,
      }),
    );
  });

  it('credits the audit row to the impersonator (request.impersonation.actorUserId), not the target', async () => {
    app = await buildApp(audit, {
      user: { id: TARGET_ID }, // JWT subject = target during impersonation
      impersonation: { actorUserId: ADMIN_ID, impSessionId: 42n },
    });

    await request(app.getHttpServer())
      .patch('/test/users/77')
      .send({ status: 'ACTIVE' })
      .expect(200);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ADMIN_ID,
        impersonationSessionId: 42n,
      }),
    );
  });

  it('does not write an audit row for endpoints without @Audit', async () => {
    app = await buildApp(audit);

    await request(app.getHttpServer()).get('/test/untracked').expect(200);

    expect(audit.log).not.toHaveBeenCalled();
  });
});
