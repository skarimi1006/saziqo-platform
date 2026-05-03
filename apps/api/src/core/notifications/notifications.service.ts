import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, Prisma } from '@prisma/client';

import { ErrorCode } from '../../common/types/response.types';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';

import { NOTIFICATION_TEMPLATES, type NotificationTemplate } from './templates.catalog';
import { NON_PERSISTENT_TYPES } from './types.catalog';

// CLAUDE: Template definition shape used by the module registry. The
// registry passes its NotificationTypeDefinition through registerType()
// below, which adapts it to the internal NotificationTemplate shape.
export interface RegisterableNotificationType {
  type: string;
  inApp?: { titleFa: string; bodyFa: (vars: Record<string, unknown>) => string };
  sms?: (vars: Record<string, unknown>) => string;
  email?: { subject: string; textBody: (vars: Record<string, unknown>) => string };
}

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
  renderedTitle: string;
  renderedBody: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  // Module-registered templates layered on top of NOTIFICATION_TEMPLATES.
  // Lookup order at dispatch time: extension first, then static catalog.
  private readonly extensionTemplates = new Map<string, NotificationTemplate>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly smsService: SmsService,
    private readonly emailService: EmailService,
  ) {}

  // Called by ModuleRegistryService.mergeNotificationTypes() at boot.
  // Idempotent: re-registering the same type overwrites the prior entry,
  // so a module bumping its template content does not double-register.
  registerType(def: RegisterableNotificationType): void {
    if (NOTIFICATION_TEMPLATES[def.type]) {
      this.logger.warn(
        `Notification type ${def.type} collides with a core template — module override applied`,
      );
    }
    const template: NotificationTemplate = {};
    if (def.inApp) {
      template.inApp = { title: def.inApp.titleFa, body: def.inApp.bodyFa };
    }
    if (def.sms) template.sms = def.sms;
    if (def.email) template.email = def.email;
    this.extensionTemplates.set(def.type, template);
  }

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const { userId, type, payload, channels } = input;
    const dispatched: NotificationChannelInput[] = [];
    const failures: DispatchFailure[] = [];

    const template = this.extensionTemplates.get(type) ?? NOTIFICATION_TEMPLATES[type];
    if (!template) {
      this.logger.warn(`No template defined for notification type: ${type} — skipping`);
      return { dispatched, failures };
    }

    for (const channel of channels) {
      try {
        if (channel === 'IN_APP') {
          // OTP codes must never be stored in the notifications table —
          // the payload would contain the plaintext one-time code.
          if (NON_PERSISTENT_TYPES.has(type)) {
            this.logger.warn(`Skipping IN_APP row for non-persistent type: ${type}`);
            continue;
          }
          if (!template.inApp) {
            this.logger.warn(`No IN_APP template for type: ${type} — skipping`);
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
          if (!template.sms) {
            this.logger.warn(`No SMS template for type: ${type} — skipping`);
            continue;
          }
          const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { phone: true },
          });
          if (!user) {
            failures.push({ channel: 'SMS', error: 'User not found' });
            continue;
          }
          const message = template.sms(payload);
          await this.smsService.send(user.phone, message);
          dispatched.push('SMS');
        } else if (channel === 'EMAIL') {
          if (!template.email) {
            this.logger.warn(`No EMAIL template for type: ${type} — skipping`);
            continue;
          }
          const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { email: true },
          });
          if (!user?.email) {
            this.logger.warn(`User ${userId.toString()} has no email — skipping EMAIL channel`);
            continue;
          }
          await this.emailService.send({
            to: user.email,
            subject: template.email.subject,
            textBody: template.email.textBody(payload),
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

  // Returns notification row enriched with rendered Persian title and body
  // using the NOTIFICATION_TEMPLATES catalog. Falls back to raw type string
  // when no inApp template is defined (should not happen for stored rows).
  renderForUser(notification: NotificationRow): NotificationView {
    const template =
      this.extensionTemplates.get(notification.type) ?? NOTIFICATION_TEMPLATES[notification.type];
    const payload = notification.payload as Record<string, unknown>;

    if (template?.inApp) {
      return {
        id: notification.id,
        type: notification.type,
        payload: notification.payload,
        readAt: notification.readAt,
        createdAt: notification.createdAt,
        renderedTitle: template.inApp.title,
        renderedBody: template.inApp.body(payload),
      };
    }

    return {
      id: notification.id,
      type: notification.type,
      payload: notification.payload,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      renderedTitle: notification.type,
      renderedBody: notification.type,
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
}
