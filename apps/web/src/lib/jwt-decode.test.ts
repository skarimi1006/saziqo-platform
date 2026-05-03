import { describe, expect, it } from 'vitest';

import { decodeJwtPayload } from './jwt-decode';

function makeJwt(payload: Record<string, unknown>): string {
  const enc = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.fakesig`;
}

describe('decodeJwtPayload', () => {
  it('decodes a valid JWT payload', () => {
    const token = makeJwt({ sub: '42', exp: 1700000000, imp: '7' });
    const result = decodeJwtPayload(token);
    expect(result).toEqual({ sub: '42', exp: 1700000000, imp: '7' });
  });

  it('decodes UTF-8 claims (Persian)', () => {
    const token = makeJwt({ name: 'علی' });
    const result = decodeJwtPayload<{ name: string }>(token);
    expect(result?.name).toBe('علی');
  });

  it('returns null for malformed tokens', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('only.two')).toBeNull();
    expect(decodeJwtPayload('')).toBeNull();
  });

  it('returns null when payload is not valid base64url JSON', () => {
    expect(decodeJwtPayload('header.@@@.sig')).toBeNull();
  });
});
