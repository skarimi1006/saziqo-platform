import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { PaymentStatus, Prisma, RefundStatus } from '@prisma/client';

import { ErrorCode } from '../../common/types/response.types';
import { ConfigService } from '../../config/config.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/types.catalog';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';

import { PaymentLedgerReconciler } from './payment-ledger.reconciler';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.interface';

const PURPOSE_PATTERN = /^[a-z_]+(:.+)?$/;

// Core purposes are always accepted regardless of which (if any) modules
// have registered. ModuleRegistryService.mergePaymentPurposes() extends
// this set with module-supplied purposes at boot.
const CORE_PAYMENT_PURPOSES: ReadonlySet<string> = new Set(['wallet_topup']);

// SECURITY: ZarinPal's refund() throws a plain Error tagged with the
// REFUND_NOT_SUPPORTED_BY_PROVIDER code. We detect this string explicitly
// so that any *other* provider error fails loudly and we don't silently
// fall into manual-refund mode on a transient gateway issue.
function isRefundNotSupportedError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes(ErrorCode.REFUND_NOT_SUPPORTED_BY_PROVIDER);
  }
  return false;
}

function isInsufficientFundsError(err: unknown): boolean {
  if (err instanceof HttpException) {
    const response = err.getResponse();
    if (response && typeof response === 'object' && 'code' in response) {
      return (response as { code: unknown }).code === ErrorCode.INSUFFICIENT_FUNDS;
    }
  }
  return false;
}

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

export interface RefundInput {
  paymentId: bigint;
  amount?: bigint | undefined;
  reason: string;
  actorUserId: bigint;
}

export interface MarkRefundCompletedInput {
  refundId: bigint;
  bankReference: string;
  actorUserId: bigint;
}

export interface RefundRow {
  id: bigint;
  paymentId: bigint;
  amount: bigint;
  reason: string;
  status: RefundStatus;
  requestedByUserId: bigint;
  requestedAt: Date;
  completedAt: Date | null;
  bankReference: string | null;
}

export interface RefundPage {
  items: RefundRow[];
  nextCursor: bigint | null;
  hasMore: boolean;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  // Allow-list populated by ModuleRegistryService at boot. When non-empty,
  // a purpose must be in CORE_PAYMENT_PURPOSES, the module-registered set,
  // or match the legacy regex. The legacy regex remains as a safety net so
  // pre-registry callers (and existing tests) continue to function until
  // every consumer migrates to a registered purpose.
  private moduleAllowedPurposes: ReadonlySet<string> = new Set();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly reconciler: PaymentLedgerReconciler,
    private readonly wallets: WalletsService,
    private readonly ledger: LedgerService,
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
      // CLAUDE: The Payment update lives in an outer $transaction so the
      // SUCCEEDED state flip is atomic. The reconciler is invoked from
      // inside the callback (per the 10D plan) but does its ledger work
      // through LedgerService — which opens its own inner transaction.
      // Any drift between Payment.status and ledger entry presence is
      // caught by the reconciler's idempotency check on the
      // `payment:<id>` reference, so retries (whether automatic or via a
      // manual reconcile sweep) cannot double-credit.
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
        await this.reconciler.reconcile(payment.id);
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

  // SECURITY: Refunds are reverse-money. Authorization (admin:approve:payout
  // + S6 confirm header) is enforced at the controller layer. The service
  // protects against accounting errors: only SUCCEEDED payments can be
  // refunded, and the cumulative refund amount cannot exceed the original
  // payment. PENDING_MANUAL refunds count toward the cap to prevent
  // double-issuance — even though the plan only requires summing COMPLETED
  // ones, summing both statuses is the safer interpretation since the wallet
  // debit lands at request time and the platform owes the user from then on.
  async refund(input: RefundInput): Promise<RefundRow> {
    const payment = await this.prisma.payment.findUnique({ where: { id: input.paymentId } });
    if (!payment) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Payment not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    if (payment.status !== PaymentStatus.SUCCEEDED) {
      throw new HttpException(
        {
          code: ErrorCode.PAYMENT_NOT_REFUNDABLE,
          message: `Cannot refund payment with status ${payment.status}`,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const refundAmount = input.amount ?? payment.amount;
    if (refundAmount <= 0n) {
      throw new HttpException(
        { code: ErrorCode.VALIDATION_ERROR, message: 'Refund amount must be positive' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const sumResult = await this.prisma.refund.aggregate({
      where: { paymentId: input.paymentId },
      _sum: { amount: true },
    });
    const alreadyRefunded = sumResult._sum.amount ?? 0n;
    const remaining = payment.amount - alreadyRefunded;
    if (refundAmount > remaining) {
      throw new HttpException(
        {
          code: ErrorCode.REFUND_AMOUNT_EXCEEDS_AVAILABLE,
          message: `Refund amount ${refundAmount.toString()} exceeds available ${remaining.toString()} (payment ${payment.amount.toString()} - already-refunded ${alreadyRefunded.toString()})`,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // Probe the provider. ZarinPal v1 throws REFUND_NOT_SUPPORTED_BY_PROVIDER,
    // which is the manual-mode signal; any other failure is unexpected and
    // re-thrown so it surfaces as a 5xx.
    let providerSupportsAutoRefund = false;
    try {
      const result = await this.provider.refund({
        providerReference: payment.providerReference ?? '',
        amount: refundAmount,
        reason: input.reason,
      });
      providerSupportsAutoRefund = result.refunded;
    } catch (err) {
      if (!isRefundNotSupportedError(err)) {
        const message = err instanceof Error ? err.message : 'Unknown provider error';
        this.logger.error(
          `Provider refund failed for payment ${payment.id.toString()}: ${message}`,
        );
        throw err;
      }
      this.logger.debug(
        `Provider does not support automated refund — falling back to manual mode for payment ${payment.id.toString()}`,
      );
    }

    const refund = await this.prisma.refund.create({
      data: {
        paymentId: payment.id,
        amount: refundAmount,
        reason: input.reason,
        status: providerSupportsAutoRefund ? RefundStatus.COMPLETED : RefundStatus.PENDING_MANUAL,
        requestedByUserId: input.actorUserId,
        completedAt: providerSupportsAutoRefund ? new Date() : null,
      },
    });

    if (payment.purpose === 'wallet_topup') {
      try {
        const wallet = await this.wallets.findOrCreateForUser(payment.userId);
        await this.ledger.debit({
          walletId: wallet.id,
          amount: refundAmount,
          reference: `refund:${refund.id.toString()}`,
          description: `Refund — payment #${payment.id.toString()}`,
          metadata: { refundId: refund.id.toString(), paymentId: payment.id.toString() },
        });
      } catch (err) {
        if (isInsufficientFundsError(err)) {
          // CLAUDE: The Refund row stays so ops have an audit trail and can
          // resolve manually (e.g., after the user adds funds). The
          // alreadyRefunded calculation will count this row as well, which
          // blocks accidental retries until the operation is finalised.
          throw new HttpException(
            {
              code: ErrorCode.CANNOT_REFUND_INSUFFICIENT_BALANCE,
              message:
                'User wallet has insufficient balance to absorb the refund. Refund row created — admin must resolve manually.',
            },
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        throw err;
      }
    }

    await this.notifications.dispatch({
      userId: payment.userId,
      type: NOTIFICATION_TYPES.PAYMENT_REFUNDED,
      payload: { amount: refundAmount, paymentId: payment.id.toString() },
      channels: ['IN_APP', 'SMS'],
    });

    return refund;
  }

  // CLAUDE: For MVP this endpoint is an ops confirmation — the wallet debit
  // lands at refund-request time, so by the time admin marks the refund as
  // COMPLETED the platform's internal ledger is already squared. The bank
  // reference is recorded as the audit trail for the off-platform transfer.
  async markRefundCompleted(input: MarkRefundCompletedInput): Promise<RefundRow> {
    const refund = await this.prisma.refund.findUnique({ where: { id: input.refundId } });
    if (!refund) {
      throw new HttpException(
        { code: ErrorCode.NOT_FOUND, message: 'Refund not found' },
        HttpStatus.NOT_FOUND,
      );
    }
    if (refund.status !== RefundStatus.PENDING_MANUAL) {
      throw new HttpException(
        {
          code: ErrorCode.REFUND_NOT_PENDING,
          message: `Refund cannot be marked completed from status ${refund.status}`,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    return this.prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: RefundStatus.COMPLETED,
        completedAt: new Date(),
        bankReference: input.bankReference,
      },
    });
  }

  async findRefundsForAdmin(filters: {
    status?: RefundStatus | undefined;
    paymentId?: bigint | undefined;
    cursor?: bigint | undefined;
    limit: number;
  }): Promise<RefundPage> {
    const take = filters.limit + 1;
    const where: Prisma.RefundWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.paymentId) where.paymentId = filters.paymentId;
    if (filters.cursor) where.id = { lt: filters.cursor };

    const rows = await this.prisma.refund.findMany({
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

  // Idempotent: called by ModuleRegistryService.mergePaymentPurposes() at
  // boot with the merged set of purposes from every enabled module. Safe
  // to call repeatedly; the latest call wins.
  registerAllowedPurposes(purposes: readonly string[]): void {
    this.moduleAllowedPurposes = new Set(purposes);
  }

  private validatePurpose(purpose: string): void {
    if (CORE_PAYMENT_PURPOSES.has(purpose)) return;
    if (this.moduleAllowedPurposes.has(purpose)) return;
    if (PURPOSE_PATTERN.test(purpose)) return;
    throw new HttpException(
      {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid payment purpose',
      },
      HttpStatus.BAD_REQUEST,
    );
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
