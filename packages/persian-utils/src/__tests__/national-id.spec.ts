import { isValidIranianNationalId } from '../national-id';

describe('isValidIranianNationalId', () => {
  describe('valid IDs', () => {
    it.each([
      // remainder=3 (>=2), check=11-3=8 → last digit 8
      ['0084575948', 'known valid, remainder≥2 branch'],
      // remainder=1 (<2), check=1 → last digit 1
      ['1234567891', 'known valid, remainder<2 branch'],
    ])('accepts %s (%s)', (id) => {
      expect(isValidIranianNationalId(id)).toBe(true);
    });
  });

  describe('all-same-digit IDs are rejected (NISO rule)', () => {
    it.each([
      '0000000000',
      '1111111111',
      '2222222222',
      '3333333333',
      '4444444444',
      '5555555555',
      '6666666666',
      '7777777777',
      '8888888888',
      '9999999999',
    ])('rejects %s', (id) => {
      expect(isValidIranianNationalId(id)).toBe(false);
    });
  });

  describe('wrong format', () => {
    it.each([
      ['123456789', '9 digits'],
      ['12345678901', '11 digits'],
      ['123456789a', 'contains letter'],
      ['', 'empty string'],
      ['          ', 'spaces'],
    ])('rejects %s (%s)', (id) => {
      expect(isValidIranianNationalId(id)).toBe(false);
    });
  });

  describe('invalid checksum', () => {
    it.each([
      // 0084575948 is valid; changing last digit breaks checksum
      ['0084575940', 'last digit 0 instead of 8'],
      ['0084575941', 'last digit 1 instead of 8'],
      // 1234567891 is valid; changing last digit breaks checksum
      ['1234567890', 'last digit 0 instead of 1'],
      ['1234567899', 'last digit 9 instead of 1'],
    ])('rejects %s (%s)', (id) => {
      expect(isValidIranianNationalId(id)).toBe(false);
    });
  });
});
