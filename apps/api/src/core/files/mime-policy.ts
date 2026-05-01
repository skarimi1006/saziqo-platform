// SECURITY: Allow-list of MIME types accepted per upload `purpose`. Adding
// a MIME here means an attacker who controls a path that flows into the
// upload endpoint can ship that file format — review additions carefully.
//
// `document` is the most restrictive bucket and is the default when a
// caller omits `purpose`, so a misconfigured form cannot accidentally
// open up image/svg or archive uploads.
export const MIME_ALLOWLIST_BY_PURPOSE: Record<string, readonly string[]> = {
  avatar: ['image/jpeg', 'image/png', 'image/webp'],
  document: ['application/pdf'],
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'],
  archive: ['application/zip'],
  text: ['text/plain', 'text/markdown'],
};

export const DEFAULT_PURPOSE = 'document';

export function isMimeAllowedForPurpose(mime: string, purpose: string): boolean {
  const list = MIME_ALLOWLIST_BY_PURPOSE[purpose];
  if (!list) return false;
  return list.includes(mime);
}

// Compares MIME types by their *base* (the part before "+", and case-
// insensitive), so "image/svg+xml" and "image/svg" agree, and "text/html"
// and "TEXT/HTML" agree. We do not compare exact strings because clients
// freely add charset parameters or use slightly different casing.
export function baseMime(mime: string): string {
  const semi = mime.indexOf(';');
  const trimmed = (semi === -1 ? mime : mime.slice(0, semi)).trim().toLowerCase();
  const plus = trimmed.indexOf('+');
  return plus === -1 ? trimmed : trimmed.slice(0, plus);
}

export function mimesMatch(a: string, b: string): boolean {
  return baseMime(a) === baseMime(b);
}
