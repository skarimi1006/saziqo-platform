import { isValidIranianIban } from '../iban';

describe('isValidIranianIban', () => {
  // IR38 0570 0287 8001 0872 1900 01 — ISO 13616 mod-97 verified
  const VALID_IBAN = 'IR380570028780010872190001';

  it('accepts a valid Iranian IBAN', () => {
    expect(isValidIranianIban(VALID_IBAN)).toBe(true);
  });

  it('rejects IBANs not starting with IR', () => {
    expect(isValidIranianIban('DE89370400440532013000')).toBe(false);
    expect(isValidIranianIban('GB29NWBK60161331926819')).toBe(false);
  });

  it('rejects IBANs with wrong length', () => {
    expect(isValidIranianIban('IR3805700287800108721900')).toBe(false); // 24 chars
    expect(isValidIranianIban('IR38057002878001087219000100')).toBe(false); // 28 chars
  });

  it('rejects IBANs with non-numeric digits after IR', () => {
    expect(isValidIranianIban('IRXX0570028780010872190001')).toBe(false);
  });

  it('rejects all-zero payload', () => {
    expect(isValidIranianIban('IR000000000000000000000000')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidIranianIban('')).toBe(false);
  });

  it('handles leading/trailing whitespace (trims and validates)', () => {
    expect(isValidIranianIban(`  ${VALID_IBAN}  `)).toBe(true);
  });

  it('rejects an IBAN with a bad checksum (last digit corrupted)', () => {
    const corrupted = VALID_IBAN.slice(0, -1) + '2';
    expect(isValidIranianIban(corrupted)).toBe(false);
  });

  it('is case-insensitive for country code', () => {
    expect(isValidIranianIban(VALID_IBAN.toLowerCase())).toBe(true);
  });
});
