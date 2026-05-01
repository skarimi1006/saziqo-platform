// SECURITY: Focused SVG sanitizer used only for files that file-type has
// already confirmed are XML/SVG. We deliberately avoid pulling jsdom +
// DOMPurify because their transitive ESM-only deps break Jest under
// CommonJS. The attack surface for SVG-as-XSS is narrow:
//   1. <script> blocks
//   2. <foreignObject> (allows arbitrary HTML inside SVG, including <iframe>)
//   3. on*= event-handler attributes
//   4. href / xlink:href / src starting with javascript:
//   5. <use href="data:..."> / external resource references
// Stripping these and then refusing the upload if the sanitized output
// lost >10% of the original markup catches the vast majority of payloads.
// The remainder are caught by the Content-Disposition: attachment we
// serve the file with — browsers do not execute SVG fetched as an
// attachment.

const SCRIPT_TAG_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const SCRIPT_SELFCLOSE_RE = /<script\b[^>]*\/>/gi;
const FOREIGN_OBJECT_RE = /<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi;
const FOREIGN_OBJECT_SELFCLOSE_RE = /<foreignObject\b[^>]*\/>/gi;
// Unquoted attribute value: stops at whitespace, `>`, or `/` so a tag like
// `<g onerror=x/>` keeps its self-close marker after the attribute is stripped.
const ON_HANDLER_RE = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s/>]+)/gi;
const JAVASCRIPT_URL_RE =
  /\s(?:href|xlink:href|src)\s*=\s*(?:"[^"]*javascript:[^"]*"|'[^']*javascript:[^']*'|[^\s/>]*javascript:[^\s/>]*)/gi;
// Reference attributes pointing at external locations (data:, http(s):, file:)
// are stripped — local fragment references like href="#gradient1" remain.
const EXTERNAL_REF_RE =
  /\s(?:href|xlink:href)\s*=\s*(?:"(?:data|https?|file|ftp|blob):[^"]*"|'(?:data|https?|file|ftp|blob):[^']*')/gi;

export function sanitizeSvg(input: string): string {
  let out = input;
  out = out.replace(SCRIPT_TAG_RE, '');
  out = out.replace(SCRIPT_SELFCLOSE_RE, '');
  out = out.replace(FOREIGN_OBJECT_RE, '');
  out = out.replace(FOREIGN_OBJECT_SELFCLOSE_RE, '');
  out = out.replace(ON_HANDLER_RE, '');
  out = out.replace(JAVASCRIPT_URL_RE, '');
  out = out.replace(EXTERNAL_REF_RE, '');
  return out;
}
