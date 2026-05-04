import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'is_public';

/**
 * Marks a route as publicly accessible — no authentication required.
 * Read by guards that implement opt-out auth (global JwtAuthGuard checks
 * this key before demanding a token). Currently documentary; wired to the
 * guard when a global auth guard is added.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
