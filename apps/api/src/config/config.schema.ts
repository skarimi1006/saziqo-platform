import { z } from 'zod';

// CLAUDE: This is the single source of truth for all environment variables.
// Add new vars here first; they are available throughout the app via ConfigService.
export const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT_API: z.coerce.number().int().min(1).max(65535).default(3001),
  PORT_WEB: z.coerce.number().int().min(1).max(65535).default(3000),

  // Database
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((s) => s.startsWith('postgresql://') || s.startsWith('postgres://'), {
      message: 'DATABASE_URL must start with postgresql:// or postgres://',
    }),

  // Redis
  REDIS_URL: z
    .string()
    .min(1)
    .refine((s) => s.startsWith('redis://') || s.startsWith('rediss://'), {
      message: 'REDIS_URL must start with redis:// or rediss://',
    }),

  // Meilisearch
  MEILI_URL: z.string().url({ message: 'MEILI_URL must be a valid URL' }),
  MEILI_MASTER_KEY: z.string().min(16, 'MEILI_MASTER_KEY must be at least 16 characters'),

  // Auth — JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // Auth — OTP
  // SECURITY: Used as salt in sha256(code + phone + OTP_SALT) so an attacker
  // who exfiltrates the otp_attempts table cannot precompute rainbow tables.
  // Generate with: openssl rand -hex 32
  OTP_SALT: z.string().min(32, 'OTP_SALT must be at least 32 characters'),

  // Auth — Super Admin
  // SECURITY: Phone must be an Iranian E.164 number; seeded at first boot.
  SUPER_ADMIN_PHONE: z
    .string()
    .regex(/^\+989\d{9}$/, 'SUPER_ADMIN_PHONE must be Iranian E.164 format: +989XXXXXXXXX'),

  // Email provider (real SMTP deferred to v1.5 — smtp adapter throws at startup)
  EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),

  // SMS Provider
  SMS_PROVIDER: z.enum(['kavenegar', 'console']).default('console'),
  KAVENEGAR_API_KEY: z.string().optional(),
  KAVENEGAR_SENDER_LINE: z.string().optional(),

  // Payments
  PAYMENT_PROVIDER: z.enum(['zarinpal', 'console']).default('console'),
  ZARINPAL_MERCHANT_ID: z.string().optional(),
  ZARINPAL_SANDBOX: z.coerce.boolean().default(true),
  ZARINPAL_CALLBACK_URL: z.string().optional(),

  // File storage
  // SECURITY: FILE_STORAGE_ROOT is the canonical absolute or relative root
  // for all uploaded files. Every read/write path is resolved against this
  // root and rejected if it escapes — so changing it at runtime invalidates
  // existing files. Default targets prod; dev uses ./tmp/saziqo-files via
  // .env.example.
  FILE_STORAGE_ROOT: z.string().default('/var/saziqo-platform/files'),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(10),

  // CORS — comma-separated list of allowed origins
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const lines = result.error.errors.map((e) => `  ${e.path.join('.') || 'root'}: ${e.message}`);
    throw new Error(`Configuration validation failed:\n${lines.join('\n')}`);
  }
  return result.data;
}
