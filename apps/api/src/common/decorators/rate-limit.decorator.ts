import { SetMetadata } from '@nestjs/common';

// Format: "<count>/<unit>", e.g. "100/min", "30/sec", "5/hour", "1000/day"
export interface RateLimitProfile {
  user?: string;
  ip?: string;
}

export const RATE_LIMIT_KEY = 'rateLimit';

// Usage:
//   @RateLimit({ ip: '5/min' })  // override default for this handler
//   @Get('something') ...
export const RateLimit = (profile: RateLimitProfile): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, profile);

// Default profile applied when no @RateLimit decorator is present.
// Per-user limit only checks once req.userId is populated by auth (Phase 3J).
export const DEFAULT_RATE_LIMIT_PROFILE: RateLimitProfile = {
  user: '100/min',
  ip: '30/min',
};
