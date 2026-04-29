import { Module } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { PrismaModule } from '../prisma/prisma.module';

import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

// PrismaModule is @Global so importing here is technically redundant,
// but explicit imports make the dependency graph clearer for module
// readers and keep this module self-describing.
@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [UsersService, UsersRepository, JwtAuthGuard, PermissionGuard],
  exports: [UsersService],
})
export class UsersModule {}
