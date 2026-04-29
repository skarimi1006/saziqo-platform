import { isValidIranianPhone, normalizeIranianPhone } from '../phone';

describe('normalizeIranianPhone', () => {
  describe('valid inputs → +989XXXXXXXXX', () => {
    it.each([
      ['+989123456789', '+989123456789', 'already E.164'],
      ['989123456789', '+989123456789', 'international without +'],
      ['09123456789', '+989123456789', 'local with 0 prefix'],
      ['9123456789', '+989123456789', '10-digit local'],
      ['0098 912 345 6789', '+989123456789', '0098 with spaces'],
      ['0098-912-345-6789', '+989123456789', '0098 with hyphens'],
      ['+98 912 345 6789', '+989123456789', 'E.164 with spaces'],
      ['09120000000', '+989120000000', 'different subscriber'],
      ['09990000000', '+989990000000', 'different operator prefix'],
    ])('normalizes %s → %s (%s)', (input, expected) => {
      expect(normalizeIranianPhone(input)).toBe(expected);
    });
  });

  describe('invalid inputs → null', () => {
    it.each([
      ['', 'empty string'],
      ['123', 'too short'],
      ['+1234567890', 'non-Iranian country code'],
      ['091234567890', 'local format too long (12 chars)'],
      ['+9891234567890', 'E.164 too long'],
      ['0812345678', 'landline-like (non-mobile after normalization)'],
      ['08123456789', 'starts with 08, not mobile'],
      ['abcdefghij', 'non-numeric'],
      ['+989', 'too short E.164'],
    ])('returns null for %s (%s)', (input) => {
      expect(normalizeIranianPhone(input)).toBeNull();
    });
  });
});

describe('isValidIranianPhone', () => {
  it('returns true for valid E.164', () => {
    expect(isValidIranianPhone('+989123456789')).toBe(true);
  });

  it('returns true for local format with 0', () => {
    expect(isValidIranianPhone('09123456789')).toBe(true);
  });

  it('returns true for 10-digit local without 0', () => {
    expect(isValidIranianPhone('9123456789')).toBe(true);
  });

  it('returns false for invalid input', () => {
    expect(isValidIranianPhone('invalid')).toBe(false);
    expect(isValidIranianPhone('')).toBe(false);
    expect(isValidIranianPhone('+1234567890')).toBe(false);
  });
});
