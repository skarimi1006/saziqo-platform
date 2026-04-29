import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { PermissionsService } from './permissions.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class RbacModule {}
