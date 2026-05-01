import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';

import { LedgerService } from './ledger.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
