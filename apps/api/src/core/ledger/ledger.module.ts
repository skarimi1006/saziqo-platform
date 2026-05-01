import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';

import { LedgerAdminController } from './ledger-admin.controller';
import { LedgerService } from './ledger.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [LedgerAdminController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
