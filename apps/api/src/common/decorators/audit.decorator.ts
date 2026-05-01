import { SetMetadata } from '@nestjs/common';

export const AUDIT_META_KEY = 'audit:meta';

export type ResourceIdSource = 'param' | 'body' | 'response';

export interface AuditMeta {
  action: string;
  resource: string;
  // Path-param name, body field, or response data field that carries the
  // resource id. Default source is 'param' — most write endpoints have the
  // id in the URL.
  resourceIdParam?: string;
  resourceIdSource?: ResourceIdSource;
}

// CLAUDE: @Audit declares an HTTP endpoint as audit-tracked. The
// AuditInterceptor reads this metadata at request time and writes a row on
// both success and failure. Adding @Audit to a handler is the only change
// required — the interceptor handles redaction, hashing, and the
// impersonation-actor swap. Imperative audit.log calls inside services are
// reserved for events the HTTP layer can't see (e.g. SESSION_REPLAY_DETECTED
// during refresh-token rotation, where the throw rolls back the tx).
export const Audit = (meta: AuditMeta): MethodDecorator & ClassDecorator =>
  SetMetadata(AUDIT_META_KEY, meta);
