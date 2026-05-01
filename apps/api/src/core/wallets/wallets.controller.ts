import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodQuery } from '../../common/decorators/zod-query.decorator';
import { JwtAuthGuard, AuthenticatedUser } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { LedgerService } from '../ledger/ledger.service';

import { WalletsService } from './wallets.service';

type AuthRequest = Request & { user: AuthenticatedUser };

const WalletEntriesQuerySchema = z.object({
  cursor: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? BigInt(v) : undefined)),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(parseInt(v ?? '20', 10), 50)),
});

type WalletEntriesQuery = z.infer<typeof WalletEntriesQuerySchema>;

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('users/me/wallet')
export class WalletsController {
  constructor(
    private readonly wallets: WalletsService,
    private readonly ledger: LedgerService,
  ) {}

  @Get()
  @RequirePermission('users:read:profile_self')
  async getMyWallet(req: AuthRequest) {
    const userId = req.user.id;
    const wallet = await this.wallets.findByUserId(userId);
    const page = await this.ledger.findEntriesForWallet(wallet.id, { limit: 10 });
    return { balance: wallet.balance, recentEntries: page.items };
  }

  @Get('entries')
  @RequirePermission('users:read:profile_self')
  async getMyWalletEntries(
    req: AuthRequest,
    @ZodQuery(WalletEntriesQuerySchema) query: WalletEntriesQuery,
  ) {
    const userId = req.user.id;
    const wallet = await this.wallets.findByUserId(userId);
    const pagination: { cursor?: bigint; limit: number } = { limit: query.limit };
    if (query.cursor !== undefined) pagination.cursor = query.cursor;
    return this.ledger.findEntriesForWallet(wallet.id, pagination);
  }
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('admin/users')
export class AdminWalletsController {
  constructor(
    private readonly wallets: WalletsService,
    private readonly ledger: LedgerService,
  ) {}

  @Get(':userId/wallet')
  @RequirePermission('admin:read:users')
  async getAdminWallet(@Param('userId') userIdStr: string) {
    const userId = BigInt(userIdStr);
    const wallet = await this.wallets.findByUserIdForAdmin(userId);
    const page = await this.ledger.findEntriesForWallet(wallet.id, { limit: 50 });
    return { balance: wallet.balance, entries: page.items, hasMore: page.hasMore };
  }
}
