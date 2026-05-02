import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { Request } from 'express';
import { z } from 'zod';

import { Audit } from '../../common/decorators/audit.decorator';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { ZodQuery } from '../../common/decorators/zod-query.decorator';
import { JwtAuthGuard, AuthenticatedUser } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { AUDIT_ACTIONS } from '../audit/actions.catalog';

import { PaymentsService, type PaymentRow } from './payments.service';

type AuthRequest = Request & { user: AuthenticatedUser };

// ──────── schemas ────────

const InitiatePaymentSchema = z.object({
  amount: z
    .string()
    .transform((v) => BigInt(v))
    .refine((v) => v > 0n, { message: 'Amount must be positive' }),
  purpose: z.string().regex(/^[a-z_]+(:.+)?$/, 'Invalid purpose format'),
  description: z.string().min(1).max(500),
  metadata: z.record(z.unknown()).optional(),
});
type InitiatePaymentDto = z.infer<typeof InitiatePaymentSchema>;

const UserPaymentsQuerySchema = z.object({
  cursor: z
    .string()
    .optional()
    .transform((v): bigint | undefined => (v !== undefined ? BigInt(v) : undefined)),
  limit: z
    .string()
    .optional()
    .transform((v): number => Math.min(parseInt(v ?? '20', 10), 50)),
});
type UserPaymentsQuery = z.infer<typeof UserPaymentsQuerySchema>;

const AdminPaymentsQuerySchema = z.object({
  status: z.nativeEnum(PaymentStatus).optional(),
  userId: z
    .string()
    .optional()
    .transform((v): bigint | undefined => (v !== undefined ? BigInt(v) : undefined)),
  cursor: z
    .string()
    .optional()
    .transform((v): bigint | undefined => (v !== undefined ? BigInt(v) : undefined)),
  limit: z
    .string()
    .optional()
    .transform((v): number => Math.min(parseInt(v ?? '20', 10), 50)),
});
type AdminPaymentsQuery = z.infer<typeof AdminPaymentsQuerySchema>;

// ──────── sanitization ────────

function sanitizeForUser(payment: PaymentRow) {
  return {
    id: payment.id,
    amount: payment.amount,
    purpose: payment.purpose,
    description: payment.description,
    status: payment.status,
    referenceCode: payment.referenceCode,
    initiatedAt: payment.initiatedAt,
    completedAt: payment.completedAt,
  };
}

function sanitizeForAdmin(payment: PaymentRow) {
  return {
    id: payment.id,
    userId: payment.userId,
    amount: payment.amount,
    purpose: payment.purpose,
    description: payment.description,
    status: payment.status,
    providerName: payment.providerName,
    providerReference: payment.providerReference,
    referenceCode: payment.referenceCode,
    cardPanMasked: payment.cardPanMasked,
    metadata: payment.metadata,
    initiatedAt: payment.initiatedAt,
    completedAt: payment.completedAt,
    failureReason: payment.failureReason,
  };
}

// ──────── user controller ────────

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('payments/initiate')
  @RequirePermission('users:read:profile_self')
  @Idempotent()
  @Audit({
    action: AUDIT_ACTIONS.PAYMENT_INITIATED,
    resource: 'payment',
    resourceIdSource: 'response',
    resourceIdParam: 'paymentId',
  })
  @HttpCode(HttpStatus.CREATED)
  async initiatePayment(
    @Req() req: AuthRequest,
    @ZodBody(InitiatePaymentSchema) body: InitiatePaymentDto,
  ) {
    return this.payments.initiate({
      userId: req.user.id,
      amount: body.amount,
      purpose: body.purpose,
      description: body.description,
      metadata: body.metadata,
    });
  }

  @Get('users/me/payments')
  @RequirePermission('users:read:profile_self')
  async getMyPayments(
    @Req() req: AuthRequest,
    @ZodQuery(UserPaymentsQuerySchema) query: UserPaymentsQuery,
  ) {
    const pagination: { cursor?: bigint; limit: number } = { limit: query.limit };
    if (query.cursor !== undefined) pagination.cursor = query.cursor;
    const page = await this.payments.findForUser(req.user.id, pagination);
    return {
      data: page.items.map(sanitizeForUser),
      meta: {
        pagination: {
          nextCursor: page.nextCursor?.toString() ?? undefined,
          limit: query.limit,
        },
      },
    };
  }

  @Get('users/me/payments/:id')
  @RequirePermission('users:read:profile_self')
  async getMyPayment(@Req() req: AuthRequest, @Param('id') id: string) {
    const payment = await this.payments.findById(BigInt(id), req.user.id);
    return sanitizeForUser(payment);
  }
}

// ──────── admin controller ────────

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermission('admin:read:payouts')
  async listPayments(@ZodQuery(AdminPaymentsQuerySchema) query: AdminPaymentsQuery) {
    const filters: {
      status?: PaymentStatus | undefined;
      userId?: bigint | undefined;
      cursor?: bigint | undefined;
      limit: number;
    } = { limit: query.limit };
    if (query.status !== undefined) filters.status = query.status;
    if (query.userId !== undefined) filters.userId = query.userId;
    if (query.cursor !== undefined) filters.cursor = query.cursor;
    const page = await this.payments.findForAdmin(filters);
    return {
      data: page.items.map(sanitizeForAdmin),
      meta: {
        pagination: {
          nextCursor: page.nextCursor?.toString() ?? undefined,
          limit: query.limit,
        },
      },
    };
  }
}
