import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';

import { ErrorCode } from '../../common/types/response.types';
import { ConfigService } from '../../config/config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/types.catalog';
import { PrismaService } from '../prisma/prisma.service';

import { PaymentLedgerReconciler } from './payment-ledger.reconciler';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.interface';

const PURPOSE_PATTERN = /^[a-z_]+(:.+)?$/;

export interface InitiateInput {
  userId: bigint;
  amount: bigint;
  purpose: string;
  description: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface InitiateResult {
  paymentId: bigint;
  redirectUrl: string;
}

export interface HandleCallbackInput {
  paymentId: bigint;
  providerReference: string;
  providerStatus: 'OK' | 'NOK';
}

export interface HandleCallbackResult {
  paymentId: bigint;
  status: PaymentStatus;
}

const TERMINAL_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  PaymentStatus.SUCCEEDED,
  PaymentStatus.FAILED,
  PaymentStatus.CANCELLED,
  PaymentStatus.EXPIRED,
]);

export interface PaymentRow {
  id: bigint;
  userId: bigint;
  amount: bigint;
  purpose: string;
  description: string;
  status: PaymentStatus;
  providerName: string;
  providerReference: string | null;
  referenceCode: string | null;
  cardPanMasked: string | null;
  metadata: unknown;
  initiatedAt: Date;
  completedAt: Date | null;
  failureReason: string | null;
}

export interface PaymentPage {
  items: PaymentRow[];
  nextCursor: bigint | null;
  hasMore: boolean;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly reconciler: PaymentLedgerReconciler,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    this.validatePurpose(input.purpose);

    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { phone: true, email: true },
    });
    if (!user) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'User not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    const payment = await this.prisma.payment.create({
      data: {
        userId: input.userId,
        amount: input.amount,
        purpose: input.purpose,
        description: input.description,
        status: PaymentStatus.PENDING,
        providerName: this.provider.name,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    const callbackUrl = this.buildCallbackUrl(payment.id);

    let result;
    try {
      result = await this.provider.initiate({
        amount: input.amount,
        description: input.description,
        callbackUrl,
        referenceId: payment.id.toString(),
        userMobile: user.phone,
        userEmail: user.email ?? undefined,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown provider error';
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          failureReason: reason.slice(0, 500),
          completedAt: new Date(),
        },
      });
      this.logger.error(`Payment initiation failed for payment ${payment.id}: ${reason}`);
      throw new HttpException(
        { code: ErrorCode.PAYMENT_INITIATION_FAILED, message: 'Payment initiation failed' },
        HttpStatus.BAD_GATEWAY,
      );
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { providerReference: result.providerReference },
    });

    return { paymentId: payment.id, redirectUrl: result.redirectUrl };
  }

  // SECURITY: This is the highest-stakes endpoint in the system. The verify
  // call to the gateway is the integrity check (no HMAC on the redirect),
  // so we additionally enforce that the Authority param matches the
  // providerReference we stored at initiation. A forged callback for a
  // different payment is rejected with INVALID_CALLBACK before any state
  // change. Idempotency is provided by the early-return on terminal status,
  // since GET callbacks have no Idempotency-Key header.
  async handleCallback(input: HandleCallbackInput): Promise<HandleCallbackResult> {
    const payment = await this.prisma.payment.findUnique({ where: { id: input.paymentId } });
    if (!payment) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Payment not found' },
        HttpStatus.NOT_FOUND,
      );
    }

    if (TERMINAL_STATUSES.has(payment.status)) {
      return { paymentId: payment.id, status: payment.status };
    }

    if (payment.providerReference !== input.providerReference) {
      throw new HttpException(
        { code: ErrorCode.INVALID_CALLBACK, message: 'Callback authority does not match payment' },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (input.providerStatus === 'NOK') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.CANCELLED, completedAt: new Date() },
      });
      await this.notifications.dispatch({
        userId: payment.userId,
        type: NOTIFICATION_TYPES.PAYMENT_CANCELLED,
        payload: { amount: payment.amount },
        channels: ['IN_APP'],
      });
      return { paymentId: payment.id, status: PaymentStatus.CANCELLED };
    }

    const verification = await this.provider.verify({
      providerReference: input.providerReference,
      expectedAmount: payment.amount,
    });

    if (verification.verified) {
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.SUCCEEDED,
            completedAt: new Date(),
            referenceCode: verification.referenceCode ?? null,
            cardPanMasked: verification.cardPan ?? null,
          },
        });
        await this.reconciler.reconcile(tx, payment.id);
      });

      await this.notifications.dispatch({
        userId: payment.userId,
        type: NOTIFICATION_TYPES.PAYMENT_SUCCEEDED,
        payload: { amount: payment.amount, reference: verification.referenceCode ?? '' },
        channels: ['IN_APP', 'SMS'],
      });

      return { paymentId: payment.id, status: PaymentStatus.SUCCEEDED };
    }

    const failureReason = (verification.failureReason ?? 'Verification failed').slice(0, 500);
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        completedAt: new Date(),
        failureReason,
      },
    });
    await this.notifications.dispatch({
      userId: payment.userId,
      type: NOTIFICATION_TYPES.PAYMENT_FAILED,
      payload: { amount: payment.amount },
      channels: ['IN_APP'],
    });

    return { paymentId: payment.id, status: PaymentStatus.FAILED };
  }

  async findById(id: bigint, userId?: bigint): Promise<PaymentRow> {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Payment not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    if (userId !== undefined && payment.userId !== userId) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Payment not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    return payment;
  }

  async findForUser(
    userId: bigint,
    pagination: { cursor?: bigint | undefined; limit: number },
  ): Promise<PaymentPage> {
    const take = pagination.limit + 1;
    const where: Prisma.PaymentWhereInput = {
      userId,
      ...(pagination.cursor !== undefined && { id: { lt: pagination.cursor } }),
    };

    const rows = await this.prisma.payment.findMany({
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

  async findForAdmin(filters: {
    status?: PaymentStatus | undefined;
    userId?: bigint | undefined;
    cursor?: bigint | undefined;
    limit: number;
  }): Promise<PaymentPage> {
    const take = filters.limit + 1;
    const where: Prisma.PaymentWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.userId) where.userId = filters.userId;
    if (filters.cursor) where.id = { lt: filters.cursor };

    const rows = await this.prisma.payment.findMany({
      where,
      orderBy: { id: 'desc' },
      take,
    });

    const hasMore = rows.length > filters.limit;
    const items = hasMore ? rows.slice(0, filters.limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? last.id : null;

    return { items, nextCursor, hasMore };
  }

  private validatePurpose(purpose: string): void {
    if (!PURPOSE_PATTERN.test(purpose)) {
      throw new HttpException(
        {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Invalid payment purpose format',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private buildCallbackUrl(paymentId: bigint): string {
    const configured = this.config.get('ZARINPAL_CALLBACK_URL');
    if (configured) {
      const base = configured.replace(/\/callback\/?$/, '');
      return `${base}/${paymentId.toString()}/callback`;
    }
    return `http://localhost:${this.config.get('PORT_API')}/api/v1/payments/${paymentId.toString()}/callback`;
  }
}
