import { Controller, Get, HttpException, HttpStatus, Param } from '@nestjs/common';

import { Public } from '../../common/decorators/public.decorator';
import { RedisService } from '../redis/redis.service';

@Controller('_test')
export class TestController {
  constructor(private readonly redis: RedisService) {}

  // SECURITY: This endpoint must never be reachable in production.
  // The runtime guard below throws immediately unless NODE_ENV === 'test'.
  @Get('last-otp/:phone')
  @Public()
  async lastOtp(@Param('phone') phone: string): Promise<{ code: string }> {
    if (process.env['NODE_ENV'] !== 'test') {
      throw new HttpException({ code: 'NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    }

    const code = await this.redis.getClient().get(`otp:test:${phone}`);

    if (!code) {
      throw new HttpException(
        { code: 'NOT_FOUND', message: 'No test OTP stored for this phone' },
        HttpStatus.NOT_FOUND,
      );
    }

    return { code };
  }
}
