import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotificationChannel } from '@prisma/client';

import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';

import { NotificationRow, NotificationsService } from './notifications.service';
import { NOTIFICATION_TYPES } from './types.catalog';

interface MockPrisma {
  notification: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
    count: jest.Mock;
  };
  user: {
    findUnique: jest.Mock;
  };
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: MockPrisma;
  let smsSend: jest.Mock;
  let emailSend: jest.Mock;

  const userId = 1n;
  const notificationId = 42n;

  beforeEach(async () => {
    prisma = {
      notification: {
        create: jest.fn().mockResolvedValue({ id: notificationId }),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ phone: '+989100000001', email: 'user@example.com' }),
      },
    };

    smsSend = jest.fn().mockResolvedValue(undefined);
    emailSend = jest.fn().mockResolvedValue({ messageId: 'test-id' });

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SmsService, useValue: { send: smsSend } },
        { provide: EmailService, useValue: { send: emailSend } },
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
  });

  describe('dispatch', () => {
    it('writes an IN_APP row for non-OTP types', async () => {
      const result = await service.dispatch({
        userId,
        type: NOTIFICATION_TYPES.PAYMENT_SUCCEEDED,
        payload: { amount: 50000, reference: 'REF001' },
        channels: ['IN_APP'],
      });

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId,
          channel: NotificationChannel.IN_APP,
          type: NOTIFICATION_TYPES.PAYMENT_SUCCEEDED,
          payload: { amount: 50000, reference: 'REF001' },
        },
      });
      expect(result.dispatched).toContain('IN_APP');
      expect(result.failures).toHaveLength(0);
    });

    it('does not write an IN_APP row for OTP_SENT (mixed channel dispatch)', async () => {
      const result = await service.dispatch({
        userId,
        type: NOTIFICATION_TYPES.OTP_SENT,
        payload: { code: '123456' },
        channels: ['IN_APP', 'SMS'],
      });

      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(smsSend).toHaveBeenCalledWith('+989100000001', expect.stringContaining('123456'));
      expect(result.dispatched).toContain('SMS');
      expect(result.dispatched).not.toContain('IN_APP');
    });

    it('writes IN_APP row even when SMS channel fails', async () => {
      smsSend.mockRejectedValueOnce(new Error('SMS provider unavailable'));

      const result = await service.dispatch({
        userId,
        type: NOTIFICATION_TYPES.PAYMENT_SUCCEEDED,
        payload: { amount: 100000, reference: 'REF002' },
        channels: ['IN_APP', 'SMS'],
      });

      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      expect(result.dispatched).toContain('IN_APP');
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toMatchObject({
        channel: 'SMS',
        error: 'SMS provider unavailable',
      });
    });

    it('dispatches SMS for OTP_SENT without writing a row', async () => {
      const result = await service.dispatch({
        userId,
        type: NOTIFICATION_TYPES.OTP_SENT,
        payload: { code: '654321' },
        channels: ['SMS'],
      });

      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(smsSend).toHaveBeenCalledWith('+989100000001', expect.stringContaining('654321'));
      expect(result.dispatched).toContain('SMS');
    });

    it('records SMS failure without blocking other channels', async () => {
      smsSend.mockRejectedValueOnce(new Error('provider timeout'));

      const result = await service.dispatch({
        userId,
        type: NOTIFICATION_TYPES.PAYMENT_SUCCEEDED,
        payload: { amount: 5000, reference: 'REF003' },
        channels: ['SMS', 'IN_APP'],
      });

      // IN_APP processed after SMS failure — still written
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      expect(result.failures[0]).toMatchObject({ channel: 'SMS' });
      expect(result.dispatched).toContain('IN_APP');
    });
  });

  describe('markRead', () => {
    it('sets readAt and is idempotent on double call', async () => {
      // First call: not yet read
      prisma.notification.findUnique
        .mockResolvedValueOnce({ userId, readAt: null })
        .mockResolvedValueOnce({ userId, readAt: new Date() });

      await service.markRead(notificationId, userId);

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: notificationId },
        data: { readAt: expect.any(Date) },
      });

      // Second call: already read — update should NOT be called again
      const updateCallsBefore = (prisma.notification.update as jest.Mock).mock.calls.length;
      await service.markRead(notificationId, userId);
      expect((prisma.notification.update as jest.Mock).mock.calls.length).toBe(updateCallsBefore);
    });

    it('throws NOT_FOUND when notification belongs to another user', async () => {
      prisma.notification.findUnique.mockResolvedValueOnce({ userId: 999n, readAt: null });

      await expect(service.markRead(notificationId, userId)).rejects.toBeInstanceOf(HttpException);
    });

    it('throws NOT_FOUND when notification does not exist', async () => {
      prisma.notification.findUnique.mockResolvedValueOnce(null);

      await expect(service.markRead(notificationId, userId)).rejects.toBeInstanceOf(HttpException);
    });
  });

  describe('countUnread', () => {
    it('returns the count of unread IN_APP notifications for the user', async () => {
      prisma.notification.count.mockResolvedValueOnce(3);

      const count = await service.countUnread(userId);

      expect(count).toBe(3);
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId, readAt: null, channel: NotificationChannel.IN_APP },
      });
    });

    it('returns 0 when all notifications are read', async () => {
      prisma.notification.count.mockResolvedValueOnce(0);
      const count = await service.countUnread(userId);
      expect(count).toBe(0);
    });
  });

  describe('markAllRead', () => {
    it('updates all unread IN_APP notifications for the user', async () => {
      await service.markAllRead(userId);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId, readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });
  });

  describe('findUnreadForUser', () => {
    it('returns only IN_APP unread notifications with cursor pagination', async () => {
      const mockRows = [
        {
          id: 10n,
          userId,
          channel: NotificationChannel.IN_APP,
          type: 'PROFILE_COMPLETED',
          payload: {},
          readAt: null,
          createdAt: new Date(),
        },
        {
          id: 9n,
          userId,
          channel: NotificationChannel.IN_APP,
          type: 'SESSION_REVOKED',
          payload: {},
          readAt: null,
          createdAt: new Date(),
        },
      ];
      prisma.notification.findMany.mockResolvedValueOnce(mockRows);

      const page = await service.findUnreadForUser(userId, { limit: 10 });

      expect(page.items).toHaveLength(2);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });
  });

  describe('dispatch — template-based routing', () => {
    it('returns empty result when no template is defined for the type', async () => {
      const result = await service.dispatch({
        userId,
        type: 'UNKNOWN_TYPE',
        payload: {},
        channels: ['IN_APP', 'SMS'],
      });

      expect(result.dispatched).toHaveLength(0);
      expect(result.failures).toHaveLength(0);
      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(smsSend).not.toHaveBeenCalled();
    });

    it('skips IN_APP channel with warning when template has no inApp section', async () => {
      // OTP_SENT has sms only — no inApp section
      const result = await service.dispatch({
        userId,
        type: NOTIFICATION_TYPES.OTP_SENT,
        payload: { code: '111111' },
        channels: ['IN_APP'],
      });

      expect(result.dispatched).not.toContain('IN_APP');
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('renders PAYMENT_SUCCEEDED body with amount and formats thousand separators', async () => {
      await service.dispatch({
        userId,
        type: NOTIFICATION_TYPES.PAYMENT_SUCCEEDED,
        payload: { amount: 50000, reference: 'ABC123' },
        channels: ['SMS'],
      });

      expect(smsSend).toHaveBeenCalledWith('+989100000001', expect.stringContaining('50,000'));
    });

    it('renders PAYOUT_REJECTED body with reason variable', async () => {
      await service.dispatch({
        userId,
        type: NOTIFICATION_TYPES.PAYOUT_REJECTED,
        payload: { amount: 100000, reason: 'مدارک ناقص' },
        channels: ['IN_APP'],
      });

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'PAYOUT_REJECTED',
            payload: { amount: 100000, reason: 'مدارک ناقص' },
          }),
        }),
      );
    });
  });

  describe('renderForUser', () => {
    const baseRow: NotificationRow = {
      id: 1n,
      userId: 1n,
      channel: NotificationChannel.IN_APP,
      type: NOTIFICATION_TYPES.PAYMENT_SUCCEEDED,
      payload: { amount: 75000, reference: 'REF999' },
      readAt: null,
      createdAt: new Date('2026-01-01'),
    };

    it('returns renderedTitle and renderedBody from template', () => {
      const view = service.renderForUser(baseRow);

      expect(view.renderedTitle).toBe('پرداخت موفق');
      expect(view.renderedBody).toContain('75,000');
      expect(view.renderedBody).toContain('تومان');
    });

    it('falls back to type string when no inApp template is defined', () => {
      const view = service.renderForUser({ ...baseRow, type: 'UNKNOWN_TYPE' });

      expect(view.renderedTitle).toBe('UNKNOWN_TYPE');
      expect(view.renderedBody).toBe('UNKNOWN_TYPE');
    });

    it('renders IMPERSONATION_NOTICE body with variables', () => {
      const view = service.renderForUser({
        ...baseRow,
        type: NOTIFICATION_TYPES.IMPERSONATION_NOTICE,
        payload: {
          startedAt: '2026-01-15T10:00:00.000Z',
          durationMinutes: 5,
          reason: 'بررسی مشکل',
        },
      });

      expect(view.renderedTitle).toBe('دسترسی پشتیبانی به حساب');
      expect(view.renderedBody).toContain('5');
      expect(view.renderedBody).toContain('بررسی مشکل');
    });

    it('omits channel and userId from the view shape', () => {
      const view = service.renderForUser(baseRow);

      expect(view).not.toHaveProperty('channel');
      expect(view).not.toHaveProperty('userId');
    });
  });
});
