import { Module } from '@nestjs/common';

import { ConfigModule } from './config/config.module';
import { PrismaModule } from './core/prisma/prisma.module';

@Module({
  imports: [ConfigModule, PrismaModule],
})
export class AppModule {}
