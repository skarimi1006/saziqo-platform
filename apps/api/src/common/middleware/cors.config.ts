import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

// SECURITY: When the request origin is NOT in the allow-list, the callback
// returns (null, false) which causes the cors package to omit the
// Access-Control-Allow-Origin header. The browser then blocks the request.
// We do NOT raise an error — that would surface as 500 to the client.
// Same-origin requests have no Origin header and are allowed through.
export function createCorsConfig(allowedOrigins: string[]): CorsOptions {
  return {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept-Language',
      'X-Request-Id',
      'Idempotency-Key',
    ],
    exposedHeaders: ['X-Request-Id', 'Idempotency-Key'],
    maxAge: 86_400, // 24h preflight cache
  };
}
