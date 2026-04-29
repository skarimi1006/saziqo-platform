/**
 * Validates an Iranian national ID (کد ملی) using the official checksum algorithm.
 *
 * Algorithm:
 *   sum = Σ digit[i] × (10 − i) for i = 0..8
 *   remainder = sum mod 11
 *   valid when:
 *     remainder < 2  → last digit must equal remainder
 *     remainder >= 2 → last digit must equal (11 − remainder)
 *
 * Rejects all-same-digit IDs (e.g. "0000000000") even though they
 * satisfy the checksum — these are invalid per NISO rules.
 */
export function isValidIranianNationalId(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;

  // All-same-digit IDs fail the NISO validity check.
  if (/^(\d)\1{9}$/.test(value)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(value[i]!, 10) * (10 - i);
  }

  const remainder = sum % 11;
  const checkDigit = parseInt(value[9]!, 10);

  return remainder < 2 ? checkDigit === remainder : checkDigit === 11 - remainder;
}
