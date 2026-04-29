import { NextFunction, Request, RequestHandler, Response } from 'express';
import helmet from 'helmet';

// CLAUDE: Build the helmet instance once at boot — its config depends on
// NODE_ENV (HSTS prod-only) but the resulting middleware is reusable.
// Several helmet defaults are disabled because they conflict with how an
// API talks to the SPA frontend (CORS handling done separately).
export function createSecurityHeadersMiddleware(isProduction: boolean): RequestHandler {
  const helmetMw = helmet({
    // SECURITY: HSTS only in production. Setting it in dev would persist
    // in the browser HSTS cache and force HTTPS for localhost forever.
    hsts: isProduction ? { maxAge: 31_536_000, preload: true, includeSubDomains: true } : false,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // X-Content-Type-Options: nosniff — helmet default, kept on.
    // CSP is managed by the Next.js app, not the API.
    contentSecurityPolicy: false,
    // These COxP headers can break cross-origin XHR / fetch from the SPA;
    // CORS handles cross-origin policy explicitly.
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  });

  return (req: Request, res: Response, next: NextFunction): void => {
    // Helmet 8 dropped its built-in Permissions-Policy helper. Set manually.
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    helmetMw(req, res, next);
  };
}
