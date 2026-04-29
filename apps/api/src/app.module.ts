import { Module } from '@nestjs/common';

import { DiagnosticsModule } from './_diagnostics/diagnostics.module';
import { PinoLoggerModule } from './common/middleware/logger.middleware';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './core/prisma/prisma.module';

@Module({
  imports: [PinoLoggerModule, ConfigModule, PrismaModule, DiagnosticsModule],
})
export class AppModule {}
