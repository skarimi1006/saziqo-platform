import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PayoutStatus } from '@prisma/client';
import { Request } from 'express';
import { z } from 'zod';

import { AdminOnly } from '../../common/decorators/admin-only.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { ZodQuery } from '../../common/decorators/zod-query.decorator';
import { JwtAuthGuard, AuthenticatedUser } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { AUDIT_ACTIONS } from '../audit/actions.catalog';

import { PayoutsService } from './payouts.service';

type AuthRequest = Request & { user: AuthenticatedUser };

// ──────── schemas ────────

const RequestPayoutSchema = z.object({
  amount: z.string().transform((v) => BigInt(v)),
  bankAccount: z.string().min(26).max(26),
  accountHolder: z.string().min(1).max(200),
});
type RequestPayoutDto = z.infer<typeof RequestPayoutSchema>;

const RejectPayoutSchema = z.object({
  reason: z.string().min(1).max(500),
});
type RejectPayoutDto = z.infer<typeof RejectPayoutSchema>;

const MarkPaidSchema = z.object({
  paymentReference: z.string().min(1).max(120),
});
type MarkPaidDto = z.infer<typeof MarkPaidSchema>;

const UserPayoutsQuerySchema = z.object({
  cursor: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? BigInt(v) : undefined)),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(parseInt(v ?? '20', 10), 50)),
});
type UserPayoutsQuery = z.infer<typeof UserPayoutsQuerySchema>;

const AdminPayoutsQuerySchema = z.object({
  status: z.nativeEnum(PayoutStatus).optional(),
  userId: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? BigInt(v) : undefined)),
  cursor: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? BigInt(v) : undefined)),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(parseInt(v ?? '20', 10), 50)),
});
type AdminPayoutsQuery = z.infer<typeof AdminPayoutsQuerySchema>;

// ──────── user controller ────────

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('users/me/payouts')
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Post()
  @RequirePermission('users:read:profile_self')
  @Audit({ action: AUDIT_ACTIONS.PAYOUT_REQUESTED, resource: 'payout' })
  @HttpCode(HttpStatus.CREATED)
  async requestPayout(
    @Req() req: AuthRequest,
    @ZodBody(RequestPayoutSchema) body: RequestPayoutDto,
  ) {
    return this.payouts.request({
      userId: req.user.id,
      amount: body.amount,
      bankAccount: body.bankAccount,
      accountHolder: body.accountHolder,
    });
  }

  @Get()
  @RequirePermission('users:read:profile_self')
  async getMyPayouts(
    @Req() req: AuthRequest,
    @ZodQuery(UserPayoutsQuerySchema) query: UserPayoutsQuery,
  ) {
    const pagination: { cursor?: bigint; limit: number } = { limit: query.limit };
    if (query.cursor !== undefined) pagination.cursor = query.cursor;
    return this.payouts.findForUser(req.user.id, pagination);
  }

  @Patch(':id/cancel')
  @RequirePermission('users:read:profile_self')
  @Audit({ action: AUDIT_ACTIONS.PAYOUT_CANCELLED, resource: 'payout', resourceIdParam: 'id' })
  async cancelPayout(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.payouts.cancel(BigInt(id), req.user.id);
  }
}

// ──────── admin controller ────────

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('admin/payouts')
export class AdminPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get()
  @RequirePermission('admin:read:payouts')
  async listPayouts(@ZodQuery(AdminPayoutsQuerySchema) query: AdminPayoutsQuery) {
    const filters: { status?: PayoutStatus; userId?: bigint; cursor?: bigint; limit: number } = {
      limit: query.limit,
    };
    if (query.status !== undefined) filters.status = query.status;
    if (query.userId !== undefined) filters.userId = query.userId;
    if (query.cursor !== undefined) filters.cursor = query.cursor;
    return this.payouts.findForAdmin(filters);
  }

  @Patch(':id/approve')
  @AdminOnly({ confirmHeader: true, permission: 'admin:approve:payout' })
  @Audit({ action: AUDIT_ACTIONS.PAYOUT_APPROVED, resource: 'payout', resourceIdParam: 'id' })
  async approvePayout(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.payouts.approve(BigInt(id), req.user.id);
  }

  @Patch(':id/reject')
  @AdminOnly({ confirmHeader: true, permission: 'admin:approve:payout' })
  @Audit({ action: AUDIT_ACTIONS.PAYOUT_REJECTED, resource: 'payout', resourceIdParam: 'id' })
  async rejectPayout(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @ZodBody(RejectPayoutSchema) body: RejectPayoutDto,
  ) {
    return this.payouts.reject(BigInt(id), req.user.id, body.reason);
  }

  @Patch(':id/mark-paid')
  @AdminOnly({ confirmHeader: true, permission: 'admin:approve:payout' })
  @Audit({ action: AUDIT_ACTIONS.PAYOUT_PAID, resource: 'payout', resourceIdParam: 'id' })
  async markPaid(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @ZodBody(MarkPaidSchema) body: MarkPaidDto,
  ) {
    return this.payouts.markPaid(BigInt(id), req.user.id, body.paymentReference);
  }
}
