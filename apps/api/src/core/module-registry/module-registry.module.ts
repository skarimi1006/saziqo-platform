import { Global, Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { PrismaModule } from '../prisma/prisma.module';

import { ModuleRegistryService } from './module-registry.service';

// CLAUDE: Global so the Phase-11B loader and any future admin endpoint
// (Phase 19F enable/disable UI) can inject the same registry instance
// without each module having to import this module explicitly.
@Global()
@Module({
  imports: [PrismaModule, NotificationsModule, PaymentsModule],
  providers: [ModuleRegistryService],
  exports: [ModuleRegistryService],
})
export class ModuleRegistryModule {}
