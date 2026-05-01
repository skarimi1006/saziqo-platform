import { Module } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { LedgerModule } from '../ledger/ledger.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WalletsModule } from '../wallets/wallets.module';

import { AdminPayoutsController, PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';

@Module({
  imports: [PrismaModule, LedgerModule, WalletsModule, NotificationsModule],
  controllers: [PayoutsController, AdminPayoutsController],
  providers: [PayoutsService, JwtAuthGuard, PermissionGuard],
  exports: [PayoutsService],
})
export class PayoutsModule {}
