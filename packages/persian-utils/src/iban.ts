/**
 * Validates an Iranian IBAN (شبا number).
 * Format: IR + 2 check digits + 22 numeric digits = 26 characters total.
 * Verification uses the ISO 13616 mod-97 algorithm.
 */
export function isValidIranianIban(input: string): boolean {
  if (typeof input !== 'string') return false;

  const normalized = input.trim().toUpperCase();

  if (normalized.length !== 26) return false;
  if (!normalized.startsWith('IR')) return false;

  const digits = normalized.slice(2);
  if (!/^\d{24}$/.test(digits)) return false;

  // All-zero payload is not a valid account
  if (/^0+$/.test(digits)) return false;

  // ISO 13616 mod-97: move first 4 chars to end, convert letters to digits, check mod 97 === 1
  const rearranged = normalized.slice(4) + normalized.slice(0, 4);
  const numeric = rearranged
    .split('')
    .map((ch) => {
      const code = ch.charCodeAt(0);
      // A=10, B=11, ..., Z=35
      return code >= 65 && code <= 90 ? String(code - 55) : ch;
    })
    .join('');

  return bigMod97(numeric) === 1;
}

function bigMod97(numericStr: string): number {
  let remainder = 0;
  for (const ch of numericStr) {
    remainder = (remainder * 10 + parseInt(ch, 10)) % 97;
  }
  return remainder;
}
