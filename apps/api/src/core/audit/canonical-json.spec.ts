import { createHash } from 'crypto';

import { canonicalJSONStringify } from './canonical-json';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

describe('canonicalJSONStringify', () => {
  it('produces the same string regardless of key insertion order', () => {
    const a = canonicalJSONStringify({ b: 2, a: 1, c: 3 });
    const b = canonicalJSONStringify({ c: 3, a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":1,"b":2,"c":3}');
  });

  it('is recursive — nested objects are also key-sorted', () => {
    const a = canonicalJSONStringify({ outer: { z: 1, a: 2 }, x: 3 });
    const b = canonicalJSONStringify({ x: 3, outer: { a: 2, z: 1 } });
    expect(sha256(a)).toBe(sha256(b));
  });

  it('preserves array order (arrays are not sorted)', () => {
    expect(canonicalJSONStringify(['c', 'a', 'b'])).toBe('["c","a","b"]');
  });

  it('serializes BigInt to a decimal string', () => {
    expect(canonicalJSONStringify({ id: 42n })).toBe('{"id":"42"}');
  });

  it('produces a stable hash for semantically-equal payloads with reordered keys', () => {
    const original = sha256(canonicalJSONStringify({ from: 'A', to: 'B', userId: 42n }));
    const reordered = sha256(canonicalJSONStringify({ userId: 42n, to: 'B', from: 'A' }));
    expect(original).toBe(reordered);
  });

  it('treats different value types as different (string "1" vs number 1)', () => {
    expect(sha256(canonicalJSONStringify({ x: 1 }))).not.toBe(
      sha256(canonicalJSONStringify({ x: '1' })),
    );
  });
});
