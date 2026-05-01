import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';

import { SessionsService } from './sessions.service';

@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
