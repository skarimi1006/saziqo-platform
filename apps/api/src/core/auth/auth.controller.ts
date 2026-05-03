import { Controller, HttpCode, HttpException, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';

import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { ErrorCode } from '../../common/types/response.types';
import { OtpService } from '../otp/otp.service';
import { SessionsService } from '../sessions/sessions.service';
import { SmsService } from '../sms/sms.service';
import { UsersService } from '../users/users.service';

import {
  OtpRequestDto,
  OtpRequestSchema,
  OtpVerifyDto,
  OtpVerifySchema,
} from './dto/otp-request.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly otpService: OtpService,
    private readonly smsService: SmsService,
    private readonly sessionsService: SessionsService,
    private readonly usersService: UsersService,
  ) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  async requestOtp(@ZodBody(OtpRequestSchema) body: OtpRequestDto) {
    const { code } = await this.otpService.generateAndStore(body.phone);
    await this.smsService.send(body.phone, `کد تأیید سازیکو: ${code}`);
    return { message: 'OTP sent successfully' };
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @ZodBody(OtpVerifySchema) body: OtpVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.otpService.verify(body.phone, body.code);

    if (!result.valid) {
      const codeMap: Record<string, ErrorCode> = {
        OTP_NOT_FOUND: ErrorCode.OTP_NOT_FOUND,
        OTP_EXPIRED: ErrorCode.OTP_EXPIRED,
        OTP_INVALID: ErrorCode.OTP_INVALID,
      };
      throw new HttpException(
        { code: codeMap[result.reason] ?? ErrorCode.OTP_INVALID, message: result.reason },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    await this.otpService.consume(body.phone, body.code);

    let user = await this.usersService.findByPhone(body.phone);
    if (!user) {
      user = await this.usersService.create({ phone: body.phone });
    }

    const userAgent = req.headers['user-agent'] ?? null;
    const ipAddress =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress ??
      null;

    const { accessToken, refreshCookie } = await this.sessionsService.issueTokens(
      user.id,
      userAgent,
      ipAddress,
    );

    res.cookie(refreshCookie.name, refreshCookie.value, refreshCookie.options);

    const selfView = await this.usersService.findForSelf(user.id);
    const profileComplete = user.status === 'ACTIVE';

    return {
      accessToken,
      user: selfView,
      profileComplete,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.['refresh_token'] as string | undefined;
    if (!token) {
      throw new HttpException(
        { code: ErrorCode.UNAUTHORIZED, message: 'Refresh token missing' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const { accessToken, refreshCookie } = await this.sessionsService.rotateRefreshToken(token);
    res.cookie(refreshCookie.name, refreshCookie.value, refreshCookie.options);

    return { accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.['refresh_token'] as string | undefined;

    if (token) {
      try {
        await this.sessionsService.revokeByRefreshToken(token);
      } catch {
        // Token already invalid — still clear the cookie
      }
    }

    res.clearCookie('refresh_token', {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api/v1/auth/refresh',
    });

    return { message: 'Logged out successfully' };
  }
}
