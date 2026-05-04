// SECURITY: This decoder is for **UX hints only** — it never validates the
// signature. The server is the source of truth for every authorization
// decision. We read the payload client-side just to show banners (e.g.
// "you are impersonating") without an extra round-trip after refresh.

export interface JwtPayload {
  sub?: string;
  iat?: number;
  exp?: number;
  // The API encodes impersonation context as an object (see
  // SessionsService.signImpersonationAccessToken on the API side):
  //   imp: { actorUserId: string, impSessionId: string }
  // Tests sometimes use a bare string. Consumers should narrow.
  imp?: unknown;
  [claim: string]: unknown;
}

function base64UrlDecode(segment: string): string {
  let normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  if (padding === 2) normalized += '==';
  else if (padding === 3) normalized += '=';
  else if (padding !== 0) throw new Error('Malformed base64url segment');
  // atob is available in modern browsers, Node ≥16 globals, and jsdom.
  return atob(normalized);
}

export function decodeJwtPayload<T extends JwtPayload = JwtPayload>(token: string): T | null {
  if (typeof token !== 'string' || token.length === 0) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, payload] = parts;
  if (!payload) return null;
  try {
    const decoded = base64UrlDecode(payload);
    // Convert binary string to UTF-8 properly so non-ASCII claims survive.
    const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    const json = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
