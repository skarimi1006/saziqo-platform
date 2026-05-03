import { Module } from '@nestjs/common';

import { OtpModule } from '../otp/otp.module';
import { SessionsModule } from '../sessions/sessions.module';
import { SmsModule } from '../sms/sms.module';
import { UsersModule } from '../users/users.module';

import { AuthController } from './auth.controller';

@Module({
  imports: [OtpModule, SmsModule, SessionsModule, UsersModule],
  controllers: [AuthController],
})
export class AuthModule {}
