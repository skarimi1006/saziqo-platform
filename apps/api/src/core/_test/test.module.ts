import { Module } from '@nestjs/common';

import { RedisModule } from '../redis/redis.module';

import { TestController } from './test.controller';

@Module({
  imports: [RedisModule],
  controllers: [TestController],
})
export class TestModule {}
