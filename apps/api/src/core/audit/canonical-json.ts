// SECURITY: payloadHash must be stable across runs and across object key
// orderings, otherwise reordering keys mid-flight would let an attacker
// alter a payload and rehash it without detection. Keys are recursively
// sorted; arrays preserve order. BigInts serialize as decimal strings —
// JSON.stringify cannot do BigInt natively, and downstream readers should
// already treat IDs as opaque strings.
export function canonicalJSONStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const v = canonicalize(obj[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return value;
}
