import '../../common/bigint-serialization';

import { ExecutionContext, HttpException, HttpStatus, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotificationChannel } from '@prisma/client';
import request from 'supertest';

import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { ErrorCode } from '../../common/types/response.types';

import { NotificationsController } from './notifications.controller';
import { NotificationRow, NotificationsService } from './notifications.service';

const CALLER_ID = 7n;

const grantedGuards = {
  jwt: {
    canActivate(ctx: ExecutionContext) {
      ctx.switchToHttp().getRequest().user = { id: CALLER_ID };
      return true;
    },
  },
  permission: { canActivate: () => true },
};

function makeRow(id: bigint, overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id,
    userId: CALLER_ID,
    channel: NotificationChannel.IN_APP,
    type: 'PAYMENT_SUCCEEDED',
    payload: { amount: 50000 },
    readAt: null,
    createdAt: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  };
}

type ServiceMock = jest.Mocked<
  Pick<
    NotificationsService,
    | 'findAllForUser'
    | 'findUnreadForUser'
    | 'countUnread'
    | 'markRead'
    | 'markAllRead'
    | 'renderForUser'
  >
>;

async function buildApp(serviceMock: Partial<NotificationsService>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [NotificationsController],
    providers: [{ provide: NotificationsService, useValue: serviceMock }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(grantedGuards.jwt)
    .overrideGuard(PermissionGuard)
    .useValue(grantedGuards.permission)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

describe('NotificationsController', () => {
  let service: ServiceMock;
  let app: INestApplication;

  beforeEach(() => {
    service = {
      findAllForUser: jest.fn(),
      findUnreadForUser: jest.fn(),
      countUnread: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
      renderForUser: jest.fn(),
    };
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('GET /users/me/notifications', () => {
    it('lists own notifications with renderedTitle/renderedBody and default limit 20', async () => {
      const row = makeRow(10n);
      service.findAllForUser.mockResolvedValue({
        items: [row],
        nextCursor: null,
        hasMore: false,
      });
      service.renderForUser.mockReturnValue({
        id: row.id,
        type: row.type,
        payload: row.payload,
        readAt: row.readAt,
        createdAt: row.createdAt,
        renderedTitle: 'پرداخت موفق',
        renderedBody: 'پرداخت شما با موفقیت انجام شد.',
      });

      app = await buildApp(service);
      const res = await request(app.getHttpServer()).get('/users/me/notifications').expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].renderedTitle).toBe('پرداخت موفق');
      expect(res.body.data[0].renderedBody).toBe('پرداخت شما با موفقیت انجام شد.');
      // Sanitized: channel and userId must not appear
      expect(res.body.data[0].channel).toBeUndefined();
      expect(res.body.data[0].userId).toBeUndefined();
      expect(res.body.meta.pagination.limit).toBe(20);
      expect(service.findAllForUser).toHaveBeenCalledWith(
        CALLER_ID,
        expect.objectContaining({ limit: 20 }),
      );
    });

    it('uses findUnreadForUser when unreadOnly=true', async () => {
      service.findUnreadForUser.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });

      app = await buildApp(service);
      await request(app.getHttpServer()).get('/users/me/notifications?unreadOnly=true').expect(200);

      expect(service.findUnreadForUser).toHaveBeenCalledWith(CALLER_ID, expect.anything());
      expect(service.findAllForUser).not.toHaveBeenCalled();
    });

    it('passes cursor to service for pagination', async () => {
      service.findAllForUser.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });

      app = await buildApp(service);
      await request(app.getHttpServer())
        .get('/users/me/notifications?cursor=99&limit=5')
        .expect(200);

      expect(service.findAllForUser).toHaveBeenCalledWith(
        CALLER_ID,
        expect.objectContaining({ cursor: 99n, limit: 5 }),
      );
    });

    it('includes nextCursor in meta when hasMore is true', async () => {
      const rows = [makeRow(10n), makeRow(9n)];
      service.findAllForUser.mockResolvedValue({
        items: rows,
        nextCursor: 9n,
        hasMore: true,
      });
      service.renderForUser.mockImplementation((n) => ({
        id: n.id,
        type: n.type,
        payload: n.payload,
        readAt: n.readAt,
        createdAt: n.createdAt,
        renderedTitle: 'عنوان',
        renderedBody: 'متن',
      }));

      app = await buildApp(service);
      const res = await request(app.getHttpServer()).get('/users/me/notifications').expect(200);

      expect(res.body.meta.pagination.nextCursor).toBe('9');
      expect(res.body.meta.hasMore).toBe(true);
    });

    it('rejects limit > 50', async () => {
      app = await buildApp(service);
      const res = await request(app.getHttpServer())
        .get('/users/me/notifications?limit=51')
        .expect(400);

      expect(res.body.error).toBeDefined();
    });
  });

  describe('GET /users/me/notifications/count-unread', () => {
    it('returns count of unread notifications', async () => {
      service.countUnread.mockResolvedValue(5);

      app = await buildApp(service);
      const res = await request(app.getHttpServer())
        .get('/users/me/notifications/count-unread')
        .expect(200);

      expect(res.body.data.count).toBe(5);
      expect(service.countUnread).toHaveBeenCalledWith(CALLER_ID);
    });
  });

  describe('PATCH /users/me/notifications/:id/read', () => {
    it('marks notification as read and returns 200', async () => {
      service.markRead.mockResolvedValue(undefined);

      app = await buildApp(service);
      const res = await request(app.getHttpServer())
        .patch('/users/me/notifications/42/read')
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(service.markRead).toHaveBeenCalledWith(42n, CALLER_ID);
    });

    it('returns 404 when notification belongs to another user', async () => {
      service.markRead.mockRejectedValue(
        new HttpException(
          { code: ErrorCode.NOT_FOUND, message: 'Notification not found' },
          HttpStatus.NOT_FOUND,
        ),
      );

      app = await buildApp(service);
      const res = await request(app.getHttpServer())
        .patch('/users/me/notifications/999/read')
        .expect(404);

      expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);
    });
  });

  describe('PATCH /users/me/notifications/read-all', () => {
    it('marks all as read using caller userId only', async () => {
      service.markAllRead.mockResolvedValue(undefined);

      app = await buildApp(service);
      await request(app.getHttpServer()).patch('/users/me/notifications/read-all').expect(200);

      expect(service.markAllRead).toHaveBeenCalledWith(CALLER_ID);
      expect(service.markAllRead).toHaveBeenCalledTimes(1);
    });
  });
});
