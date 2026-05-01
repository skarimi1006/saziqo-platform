import { maskNationalId, maskPhone, redactSensitivePayload } from './redaction';

describe('redactSensitivePayload', () => {
  it('omits refresh tokens, access tokens, and OTP codes', () => {
    const result = redactSensitivePayload({
      refreshToken: 'rt-xyz',
      accessToken: 'at-xyz',
      otpCode: '123456',
      otp: '123456',
      code: '654321',
      totpCode: '111222',
      password: 'hunter2',
      pin: '0000',
    }) as Record<string, string>;

    for (const key of [
      'refreshToken',
      'accessToken',
      'otpCode',
      'otp',
      'code',
      'totpCode',
      'password',
      'pin',
    ]) {
      expect(result[key]).toBe('[REDACTED]');
    }
  });

  it('also omits snake_case variants of sensitive keys', () => {
    const result = redactSensitivePayload({
      refresh_token: 'rt',
      access_token: 'at',
      otp_code: '123',
      totp_code: '999',
      totp_secret: 'JBSWY3DPEHPK3PXP',
    }) as Record<string, string>;
    for (const key of ['refresh_token', 'access_token', 'otp_code', 'totp_code', 'totp_secret']) {
      expect(result[key]).toBe('[REDACTED]');
    }
  });

  it('masks Iranian phone numbers to last 4 digits with +98 prefix', () => {
    const result = redactSensitivePayload({ phone: '+989123456789' }) as { phone: string };
    expect(result.phone).toBe('+98****6789');
  });

  it('masks national IDs to last 4 digits', () => {
    const result = redactSensitivePayload({ nationalId: '1234567890' }) as { nationalId: string };
    expect(result.nationalId).toBe('******7890');
  });

  it('redacts recursively through nested objects', () => {
    const result = redactSensitivePayload({
      user: {
        phone: '+989123456789',
        profile: {
          nationalId: '1234567890',
          refreshToken: 'rt-deep',
        },
      },
    }) as { user: { phone: string; profile: { nationalId: string; refreshToken: string } } };

    expect(result.user.phone).toBe('+98****6789');
    expect(result.user.profile.nationalId).toBe('******7890');
    expect(result.user.profile.refreshToken).toBe('[REDACTED]');
  });

  it('redacts inside arrays', () => {
    const result = redactSensitivePayload({
      sessions: [{ refreshToken: 'a' }, { refreshToken: 'b' }],
    }) as { sessions: Array<{ refreshToken: string }> };
    expect(result.sessions[0]!.refreshToken).toBe('[REDACTED]');
    expect(result.sessions[1]!.refreshToken).toBe('[REDACTED]');
  });

  it('leaves non-sensitive fields unchanged', () => {
    const result = redactSensitivePayload({
      action: 'LOGIN_SUCCESS',
      userId: 42,
      reason: 'support ticket',
    });
    expect(result).toEqual({
      action: 'LOGIN_SUCCESS',
      userId: 42,
      reason: 'support ticket',
    });
  });
});

describe('maskPhone', () => {
  it('masks phones with the +98 prefix preserved', () => {
    expect(maskPhone('+989123456789')).toBe('+98****6789');
  });
  it('falls back to stars+tail when there is no +98 prefix', () => {
    expect(maskPhone('09123456789')).toBe('****6789');
  });
  it('returns [REDACTED] when input is too short or non-string', () => {
    expect(maskPhone('123')).toBe('[REDACTED]');
    expect(maskPhone(null)).toBe('[REDACTED]');
    expect(maskPhone(undefined)).toBe('[REDACTED]');
    expect(maskPhone(12345)).toBe('[REDACTED]');
  });
});

describe('maskNationalId', () => {
  it('masks to last 4 digits', () => {
    expect(maskNationalId('1234567890')).toBe('******7890');
  });
  it('returns [REDACTED] for short or non-string input', () => {
    expect(maskNationalId('123')).toBe('[REDACTED]');
    expect(maskNationalId(null)).toBe('[REDACTED]');
  });
});
