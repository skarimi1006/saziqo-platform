// CLAUDE: v1 maker handle = "m" + base62(userId). Real user-chosen handles
// are deferred to v1.5 (master plan §"Cuts deferred from v1"). The same
// scheme covers review-author handles for now since reviewers are also
// user rows. Anywhere the catalog or detail responses need a stable,
// non-PII identifier for a user, route through makerHandle().

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function base62Encode(n: bigint): string {
  if (n === 0n) return '0';
  let result = '';
  const base = 62n;
  let num = n;
  while (num > 0n) {
    result = BASE62[Number(num % base)] + result;
    num = num / base;
  }
  return result;
}

export function makerHandle(userId: bigint): string {
  return 'm' + base62Encode(userId);
}
