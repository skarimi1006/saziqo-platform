import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, Prisma } from '@prisma/client';

import { ErrorCode } from '../../common/types/response.types';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';

import { NON_PERSISTENT_TYPES } from './types.catalog';

export type NotificationChannelInput = 'IN_APP' | 'SMS' | 'EMAIL';

export interface DispatchInput {
  userId: bigint;
  type: string;
  payload: Record<string, unknown>;
  channels: NotificationChannelInput[];
}

export interface DispatchFailure {
  channel: NotificationChannelInput;
  error: string;
}

export interface DispatchResult {
  dispatched: NotificationChannelInput[];
  failures: DispatchFailure[];
}

export interface NotificationPagination {
  cursor?: bigint;
  limit: number;
}

export interface NotificationRow {
  id: bigint;
  userId: bigint;
  channel: NotificationChannel;
  type: string;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationPage {
  items: NotificationRow[];
  nextCursor: bigint | null;
  hasMore: boolean;
}

// Sanitized shape returned to HTTP callers — channel and userId are omitted.
export interface NotificationView {
  id: bigint;
  type: string;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
  renderedText: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly smsService: SmsService,
    private readonly emailService: EmailService,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const { userId, type, payload, channels } = input;
    const dispatched: NotificationChannelInput[] = [];
    const failures: DispatchFailure[] = [];

    for (const channel of channels) {
      try {
        if (channel === 'IN_APP') {
          // OTP codes must never be stored in the notifications table —
          // the payload would contain the plaintext one-time code.
          if (NON_PERSISTENT_TYPES.has(type)) {
            this.logger.warn(`Skipping IN_APP row for non-persistent type: ${type}`);
            continue;
          }

          await this.prisma.notification.create({
            data: {
              userId,
              channel: NotificationChannel.IN_APP,
              type,
              payload: payload as Prisma.InputJsonValue,
            },
          });
          dispatched.push('IN_APP');
        } else if (channel === 'SMS') {
          const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { phone: true },
          });

          if (!user) {
            failures.push({ channel: 'SMS', error: 'User not found' });
            continue;
          }

          const message = this.renderSmsMessage(type, payload);
          if (!message) {
            this.logger.warn(`No SMS template for type: ${type} — skipping SMS channel`);
            continue;
          }

          await this.smsService.send(user.phone, message);
          dispatched.push('SMS');
        } else if (channel === 'EMAIL') {
          const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { email: true },
          });

          if (!user?.email) {
            this.logger.warn(`User ${userId.toString()} has no email — skipping EMAIL channel`);
            continue;
          }

          const emailContent = this.renderEmailContent(type, payload);
          if (!emailContent) {
            this.logger.warn(`No EMAIL template for type: ${type} — skipping EMAIL channel`);
            continue;
          }

          await this.emailService.send({
            to: user.email,
            subject: emailContent.subject,
            textBody: emailContent.textBody,
          });
          dispatched.push('EMAIL');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to dispatch ${channel} for type ${type}: ${message}`,
          err instanceof Error ? err.stack : undefined,
        );
        failures.push({ channel, error: message });

        // SMS / EMAIL failures must not block IN_APP which may be processed
        // later in the same loop. We continue rather than re-throw.
      }
    }

    return { dispatched, failures };
  }

  async markRead(notificationId: bigint, userId: bigint): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: { userId: true, readAt: true },
    });

    if (!notification || notification.userId !== userId) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Notification not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    // Idempotent — do nothing if already read
    if (notification.readAt !== null) {
      return;
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: bigint): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async findUnreadForUser(
    userId: bigint,
    pagination: NotificationPagination,
  ): Promise<NotificationPage> {
    return this.queryNotifications(userId, pagination, {
      readAt: null,
      channel: NotificationChannel.IN_APP,
    });
  }

  async findAllForUser(
    userId: bigint,
    pagination: NotificationPagination,
  ): Promise<NotificationPage> {
    return this.queryNotifications(userId, pagination, { channel: NotificationChannel.IN_APP });
  }

  async countUnread(userId: bigint): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null, channel: NotificationChannel.IN_APP },
    });
  }

  // Returns notification row enriched with rendered Persian text.
  // Placeholder rendering per type — replaced by NOTIFICATION_TEMPLATES in Phase 8D.
  renderForUser(notification: NotificationRow): NotificationView {
    return {
      id: notification.id,
      type: notification.type,
      payload: notification.payload,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      renderedText: this.renderInAppText(notification.type),
    };
  }

  // ──────── private helpers ────────

  private async queryNotifications(
    userId: bigint,
    pagination: NotificationPagination,
    extraWhere: Record<string, unknown>,
  ): Promise<NotificationPage> {
    const take = pagination.limit + 1;
    const where = {
      userId,
      ...extraWhere,
      ...(pagination.cursor !== undefined && { id: { lt: pagination.cursor } }),
    };

    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: { id: 'desc' },
      take,
    });

    const hasMore = rows.length > pagination.limit;
    const items = hasMore ? rows.slice(0, pagination.limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? last.id : null;

    return { items, nextCursor, hasMore };
  }

  // Minimal SMS templates for Phase 8A — replaced by full catalog in Phase 8D.
  private renderSmsMessage(type: string, payload: Record<string, unknown>): string | null {
    switch (type) {
      case 'OTP_SENT':
        return `کد تایید سازیکو: ${String(payload['code'])}\nاین کد تا ۲ دقیقه معتبر است.`;
      case 'PAYMENT_SUCCEEDED':
        return `سازیکو: پرداخت ${String(payload['amount'])} تومان تأیید شد. کد پیگیری: ${String(payload['reference'] ?? '')}`;
      default:
        return null;
    }
  }

  // Placeholder IN_APP text per type — Phase 8D replaces with variable-interpolated catalog.
  private renderInAppText(type: string): string {
    switch (type) {
      case 'PROFILE_COMPLETED':
        return 'پروفایل شما با موفقیت تکمیل شد.';
      case 'SESSION_REVOKED':
        return 'یک نشست شما لغو شد.';
      case 'IMPERSONATION_NOTICE':
        return 'پشتیبانی سازیکو به حساب شما دسترسی داشت.';
      case 'PAYMENT_SUCCEEDED':
        return 'پرداخت شما با موفقیت انجام شد.';
      case 'PAYMENT_FAILED':
        return 'پرداخت ناموفق بود.';
      case 'WALLET_CREDITED':
        return 'موجودی کیف پول شما افزایش یافت.';
      case 'WALLET_DEBITED':
        return 'موجودی کیف پول شما کاهش یافت.';
      case 'PAYOUT_REQUESTED':
        return 'درخواست تسویه ثبت شد.';
      case 'PAYOUT_APPROVED':
        return 'تسویه شما تأیید شد.';
      case 'PAYOUT_REJECTED':
        return 'درخواست تسویه رد شد.';
      default:
        return type;
    }
  }

  private renderEmailContent(
    type: string,
    payload: Record<string, unknown>,
  ): { subject: string; textBody: string } | null {
    // Notification type names map to email template keys by lowercasing
    // (e.g. PAYMENT_SUCCEEDED → payment_succeeded). Types with no matching
    // email template return null and the EMAIL channel is silently skipped.
    try {
      return this.emailService.render(type.toLowerCase(), payload);
    } catch {
      return null;
    }
  }
}
