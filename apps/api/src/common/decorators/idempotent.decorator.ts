import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';

// Mark a write endpoint as idempotent. Clients must send an Idempotency-Key
// header on every request; the IdempotencyInterceptor caches the response
// for 24h keyed by that value and returns the cached response on retry.
//
// Usage:
//   @Post()
//   @Idempotent()
//   create(@ZodBody(Schema) body) { ... }
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT_KEY, true);
