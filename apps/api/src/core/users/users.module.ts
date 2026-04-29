import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

// PrismaModule is @Global so importing here is technically redundant,
// but explicit imports make the dependency graph clearer for module
// readers and keep this module self-describing.
@Module({
  imports: [PrismaModule],
  providers: [UsersService, UsersRepository],
  exports: [UsersService],
})
export class UsersModule {}
