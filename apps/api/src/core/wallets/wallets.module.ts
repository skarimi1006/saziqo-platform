import { Module } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { LedgerModule } from '../ledger/ledger.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AdminWalletsController, WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';

@Module({
  imports: [PrismaModule, LedgerModule],
  controllers: [WalletsController, AdminWalletsController],
  providers: [WalletsService, JwtAuthGuard, PermissionGuard],
  exports: [WalletsService],
})
export class WalletsModule {}
