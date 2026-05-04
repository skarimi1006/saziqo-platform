import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';

import { AdminRolesController } from './admin-roles.controller';
import { BootstrapService } from './bootstrap.service';
import { PermissionsService } from './permissions.service';

@Global()
@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [AdminRolesController],
  providers: [PermissionsService, BootstrapService],
  exports: [PermissionsService],
})
export class RbacModule {}
