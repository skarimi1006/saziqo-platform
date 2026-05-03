import { z } from 'zod';

export const OtpRequestSchema = z.object({
  phone: z.string().regex(/^\+98[0-9]{10}$/, 'Phone must be in E.164 format: +98XXXXXXXXXX'),
});

export type OtpRequestDto = z.infer<typeof OtpRequestSchema>;

export const OtpVerifySchema = z.object({
  phone: z.string().regex(/^\+98[0-9]{10}$/, 'Phone must be in E.164 format: +98XXXXXXXXXX'),
  code: z
    .string()
    .length(6, 'OTP must be 6 digits')
    .regex(/^[0-9]+$/, 'OTP must be digits only'),
});

export type OtpVerifyDto = z.infer<typeof OtpVerifySchema>;
