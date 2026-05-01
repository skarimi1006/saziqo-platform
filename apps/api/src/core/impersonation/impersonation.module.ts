import { Module } from '@nestjs/common';

import { AdminConfirmGuard } from '../../common/guards/admin-confirm.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionsModule } from '../sessions/sessions.module';

import { ImpersonationController } from './impersonation.controller';
import { ImpersonationService } from './impersonation.service';

@Module({
  imports: [PrismaModule, SessionsModule, NotificationsModule],
  controllers: [ImpersonationController],
  providers: [ImpersonationService, JwtAuthGuard, PermissionGuard, AdminConfirmGuard],
  exports: [ImpersonationService],
})
export class ImpersonationModule {}
