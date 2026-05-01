import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

// CLAUDE: Audit is global so any service that mutates state can inject
// AuditService without an explicit import in its module. PrismaModule is
// already global; importing it here keeps the dependency graph explicit.
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
