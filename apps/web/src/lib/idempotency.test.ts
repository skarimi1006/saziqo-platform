import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearIdempotencyKey,
  generateIdempotencyKey,
  getOrCreateIdempotencyKey,
  withIdempotency,
} from './idempotency';

describe('idempotency', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('generateIdempotencyKey returns a uuid v4', () => {
    const key = generateIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('persists the key under idem:{operation}:{bodyHash} on first use', () => {
    const key = getOrCreateIdempotencyKey('topup', 'hash-1');
    expect(window.sessionStorage.getItem('idem:topup:hash-1')).toBe(key);
  });

  it('reuses the persisted key on retry', () => {
    const first = getOrCreateIdempotencyKey('topup', 'hash-1');
    const second = getOrCreateIdempotencyKey('topup', 'hash-1');
    expect(second).toBe(first);
  });

  it('uses distinct keys for distinct (operation, bodyHash) pairs', () => {
    const a = getOrCreateIdempotencyKey('topup', 'hash-1');
    const b = getOrCreateIdempotencyKey('topup', 'hash-2');
    const c = getOrCreateIdempotencyKey('refund', 'hash-1');
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('clears a stored key', () => {
    getOrCreateIdempotencyKey('topup', 'hash-1');
    clearIdempotencyKey('topup', 'hash-1');
    expect(window.sessionStorage.getItem('idem:topup:hash-1')).toBeNull();
  });

  describe('withIdempotency', () => {
    it('passes the same key on retry after a failure', async () => {
      const seenKeys: string[] = [];
      let attempt = 0;
      const op = async (key: string) => {
        seenKeys.push(key);
        attempt += 1;
        if (attempt === 1) throw new Error('network blip');
        return 'ok';
      };

      await expect(withIdempotency('topup', 'hash-1', op)).rejects.toThrow('network blip');
      const result = await withIdempotency('topup', 'hash-1', op);

      expect(result).toBe('ok');
      expect(seenKeys).toHaveLength(2);
      expect(seenKeys[0]).toBe(seenKeys[1]);
    });

    it('drops the key after a successful run', async () => {
      const result = await withIdempotency('topup', 'hash-1', async () => 'done');
      expect(result).toBe('done');
      expect(window.sessionStorage.getItem('idem:topup:hash-1')).toBeNull();
    });

    it('keeps the key in storage when the operation throws', async () => {
      await expect(
        withIdempotency('topup', 'hash-1', async () => {
          throw new Error('500');
        }),
      ).rejects.toThrow('500');
      expect(window.sessionStorage.getItem('idem:topup:hash-1')).not.toBeNull();
    });
  });
});
