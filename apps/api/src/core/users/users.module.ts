import { Module } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionsModule } from '../sessions/sessions.module';
import { WalletsModule } from '../wallets/wallets.module';

import { ProfileController } from './profile.controller';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

// PrismaModule is @Global so importing here is technically redundant,
// but explicit imports make the dependency graph clearer for module
// readers and keep this module self-describing.
// RedisModule, RbacModule, ConfigModule are @Global — no explicit import needed.
@Module({
  imports: [PrismaModule, NotificationsModule, WalletsModule, SessionsModule],
  controllers: [UsersController, ProfileController],
  providers: [UsersService, UsersRepository, JwtAuthGuard, PermissionGuard],
  exports: [UsersService],
})
export class UsersModule {}
