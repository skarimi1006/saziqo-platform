import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { UsersModule } from '../users/users.module';

import { OtpService } from './otp.service';

@Module({
  imports: [PrismaModule, RedisModule, UsersModule],
  providers: [OtpService],
  exports: [OtpService],
})
export class OtpModule {}
