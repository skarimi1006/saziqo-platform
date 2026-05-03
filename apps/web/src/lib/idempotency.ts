// CLAUDE: Wrapping a mutation in withIdempotency() makes a reload-safe
// retry: the key is keyed by `${operation}:${bodyHash}` and persisted to
// sessionStorage, so navigating back-and-forward or refreshing the
// page during a slow POST won't double-charge a wallet, double-send an
// SMS, etc. The server-side idempotency cache (Phase 4D / 10A) is the
// authoritative dedup; this just makes the client present a stable key.

import { v4 as uuidv4 } from 'uuid';

const STORAGE_PREFIX = 'idem:';

export function generateIdempotencyKey(): string {
  return uuidv4();
}

function storageAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return typeof window.sessionStorage !== 'undefined';
  } catch {
    return false;
  }
}

function storageKey(operation: string, bodyHash: string): string {
  return `${STORAGE_PREFIX}${operation}:${bodyHash}`;
}

export function getOrCreateIdempotencyKey(operation: string, bodyHash: string): string {
  const key = storageKey(operation, bodyHash);
  if (storageAvailable()) {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const generated = generateIdempotencyKey();
    window.sessionStorage.setItem(key, generated);
    return generated;
  }
  return generateIdempotencyKey();
}

export function clearIdempotencyKey(operation: string, bodyHash: string): void {
  if (!storageAvailable()) return;
  window.sessionStorage.removeItem(storageKey(operation, bodyHash));
}

export async function withIdempotency<T>(
  operation: string,
  bodyHash: string,
  fn: (idempotencyKey: string) => Promise<T>,
): Promise<T> {
  const key = getOrCreateIdempotencyKey(operation, bodyHash);
  try {
    const result = await fn(key);
    // Success: drop the key so the same logical operation can run again
    // later (e.g. user submits a second top-up after the first succeeds).
    clearIdempotencyKey(operation, bodyHash);
    return result;
  } catch (err) {
    // Keep the key on failure so retrying after a network blip reuses it
    // and the server returns the cached response instead of double-running.
    throw err;
  }
}
