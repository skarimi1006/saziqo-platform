import { Module } from '@nestjs/common';

import { DiagnosticsModule } from './_diagnostics/diagnostics.module';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './core/prisma/prisma.module';

@Module({
  imports: [ConfigModule, PrismaModule, DiagnosticsModule],
})
export class AppModule {}
