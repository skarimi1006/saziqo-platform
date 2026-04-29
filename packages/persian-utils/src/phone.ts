const NORMALIZED_REGEX = /^\+989\d{9}$/;

/**
 * Accepts common Iranian mobile phone formats and returns E.164 (+989XXXXXXXXX).
 * Returns null for any unrecognized or structurally invalid input.
 *
 * Accepted input formats:
 *   +989XXXXXXXXX  — already E.164 (13 chars)
 *    989XXXXXXXXX  — international without +  (12 digits)
 *    09XXXXXXXXX   — local with leading 0     (11 chars)
 *     9XXXXXXXXX   — local without leading 0  (10 chars)
 *   0098 variants  — operator-dialed international prefix
 * Spaces, hyphens, dots, and parentheses are stripped before parsing.
 */
export function normalizeIranianPhone(raw: string): string | null {
  const cleaned = raw.trim().replace(/[\s\-().]/g, '');

  let local: string;

  if (/^\+98(\d{10})$/.test(cleaned)) {
    local = cleaned.slice(3);
  } else if (/^0098(\d{10})$/.test(cleaned)) {
    local = cleaned.slice(4);
  } else if (/^98(\d{10})$/.test(cleaned)) {
    local = cleaned.slice(2);
  } else if (/^0(\d{10})$/.test(cleaned)) {
    local = cleaned.slice(1);
  } else if (/^\d{10}$/.test(cleaned)) {
    local = cleaned;
  } else {
    return null;
  }

  const normalized = `+98${local}`;
  return NORMALIZED_REGEX.test(normalized) ? normalized : null;
}

export function isValidIranianPhone(value: string): boolean {
  return normalizeIranianPhone(value) !== null;
}
