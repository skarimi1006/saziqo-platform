// SECURITY: Audit payloads pass through redactSensitivePayload before they
// are hashed and persisted. The rules are deny-list by key name — any key
// added below is masked or stripped recursively no matter how deep it
// appears. Adding a new sensitive key is cheap; missing one leaks PII or
// credentials into a permanent, immutable row.

const PHONE_KEYS = new Set(['phone', 'phoneNumber', 'mobile']);
const NATIONAL_ID_KEYS = new Set(['nationalId', 'national_id']);
const OMIT_KEYS = new Set([
  'refreshToken',
  'refresh_token',
  'accessToken',
  'access_token',
  'otp',
  'otpCode',
  'otp_code',
  'code', // OTP submission body uses { code }
  'totpCode',
  'totp_code',
  'totpSecret',
  'totp_secret',
  'password',
  'pin',
]);

const REDACTED_PLACEHOLDER = '[REDACTED]';

export function redactSensitivePayload(payload: unknown): unknown {
  return redactValue(payload);
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value !== null && typeof value === 'object') {
    return redactObject(value as Record<string, unknown>);
  }
  return value;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(obj)) {
    if (OMIT_KEYS.has(key)) {
      out[key] = REDACTED_PLACEHOLDER;
      continue;
    }
    if (PHONE_KEYS.has(key)) {
      out[key] = maskPhone(raw);
      continue;
    }
    if (NATIONAL_ID_KEYS.has(key)) {
      out[key] = maskNationalId(raw);
      continue;
    }
    out[key] = redactValue(raw);
  }
  return out;
}

// Masks an Iranian phone number to `+98****1234`. Non-string inputs and
// short strings (anything under 4 digits) are fully redacted — partial
// masking only makes sense when there is enough length to leave a tail.
export function maskPhone(value: unknown): string {
  if (typeof value !== 'string' || value.length < 4) return REDACTED_PLACEHOLDER;
  const tail = value.slice(-4);
  const prefix = value.startsWith('+98') ? '+98' : '';
  return `${prefix}****${tail}`;
}

// Masks a national ID to last 4 digits with leading mask.
export function maskNationalId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 4) return REDACTED_PLACEHOLDER;
  return `******${value.slice(-4)}`;
}
