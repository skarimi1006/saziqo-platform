# سازیکو Platform — Phase Groups 5–7 (Lean MVP, Executable)

> Read alongside `saziqo-platform-system-plan.md` and `saziqo-platform-phases-1-4.md`.
> Phase Groups 5–7 build on the auth + RBAC foundation completed in 1–4.
> Per-phase rules and conventions identical to phases 1–4.

---

## Pre-execution Prerequisites for Phase Groups 5–10

These were locked when expanding Phase Groups 5–10:

| #   | Decision                       | Value                                                   |
| --- | ------------------------------ | ------------------------------------------------------- |
| 1   | Audit log retention            | Keep forever in v1                                      |
| 2   | File storage path              | `/var/saziqo-platform/files/{uploads,temp}/...`         |
| 3   | Max upload size                | 10 MB default, up to 100 MB per-route configurable      |
| 4   | Allowed MIME types             | Strict allow-list, MIME-sniffed via `file-type` library |
| 5   | Notification template language | Persian, hardcoded TS constants (no i18n)               |
| 6   | Email templates                | Placeholders only, real templates in v1.5               |

---

# Phase Group 5 — Users + Admin Impersonation

## Phase 5A: Users Read Endpoints + Admin List

**Model: 🟢 Sonnet** | ~180 LOC

**Deliverables:**

- Add to `apps/api/src/core/users/users.service.ts`:
  - `findManyForAdmin(filters, pagination)` — list users with filters: status, role, phoneContains, search query (firstName/lastName/email), createdAfter, createdBefore
  - `findByIdForAdmin(id)` — full user record including roles
  - Cursor-based pagination using `id` as cursor
- Add to `apps/api/src/core/users/users.controller.ts`:
  - `GET /api/v1/admin/users` — `@RequirePermission('admin:read:users')`, query params validated via Zod, returns `{ data: User[], meta: { cursor, limit, hasMore } }`
  - `GET /api/v1/admin/users/:id` — `@RequirePermission('admin:read:users')`
- Sanitization: admin endpoints expose more fields than self endpoints (status, all roles, IP/UA from last session) but still hide sensitive fields (no internal flags)
- Unit tests for service, integration tests for endpoints

**Acceptance:**

- Admin: `GET /admin/users?limit=20` → 200 with up to 20 users
- Admin: `GET /admin/users?status=ACTIVE&search=احمد` → filtered correctly
- Pagination: response includes `meta.cursor` for next page
- Regular user → 403 `FORBIDDEN`

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
and SAZIQO_PLATFORM_PHASES_5_7.md fully. Execute Phase 5A.

Add to UsersService:
- findManyForAdmin(filters: {status?, roleId?, phoneContains?,
  search?, createdAfter?, createdBefore?}, pagination: {cursor?, limit})
  - Default limit 20, max 100
  - Search matches firstName/lastName/email via case-insensitive ILIKE
  - Returns { items, nextCursor, hasMore }
- findByIdForAdmin(id): includes userRoles with role details

Add UsersController endpoints:
- @Get('admin/users') @RequirePermission('admin:read:users')
- @Get('admin/users/:id') @RequirePermission('admin:read:users')

Zod query schema:
- status: z.nativeEnum(UserStatus).optional()
- roleId: z.coerce.bigint().optional()
- phoneContains: z.string().optional()
- search: z.string().min(2).optional()
- createdAfter, createdBefore: z.coerce.date().optional()
- cursor: z.coerce.bigint().optional()
- limit: z.coerce.number().min(1).max(100).default(20)

Admin sanitization helper: includes status, roles, lastSeenAt from
sessions, but excludes any future sensitive flags. Phone shown in full
(admin context), national ID masked except last 4 digits.

Unit tests: filters work, pagination returns correct cursor, sanitization
hides expected fields.

Integration test: admin user → 200, regular user → 403.

Commit as "feat(phase-5A): add admin user list and read endpoints".
```

---

## Phase 5B: Admin User Mutations (status, role assignment)

**Model: 🟢 Sonnet** | ~180 LOC

**Deliverables:**

- Add to `users.service.ts`:
  - `updateStatusByAdmin(userId, newStatus, actorUserId)` — transitions: PENDING_PROFILE → ACTIVE | SUSPENDED | DELETED; ACTIVE → SUSPENDED | DELETED; SUSPENDED → ACTIVE | DELETED
  - `assignRoleByAdmin(userId, roleId, scope?, actorUserId)` — calls `permissionsService.assignRoleToUser`
  - `removeRoleByAdmin(userId, roleId, actorUserId)` — guard: cannot remove super_admin from the bootstrap user (defined by `SUPER_ADMIN_PHONE` env)
- Endpoints:
  - `PATCH /api/v1/admin/users/:id` — `@RequirePermission('admin:update:user')` — body: `{ status?, firstName?, lastName?, email? }`. NOTE: phone is immutable in v1; nationalId is admin-restricted via separate endpoint (deferred).
  - `POST /api/v1/admin/users/:id/roles` — `@RequirePermission('admin:moderate:user')` — body: `{ roleId, scope? }`
  - `DELETE /api/v1/admin/users/:id/roles/:roleId` — same permission
- All mutations invalidate user permission cache
- Each mutation logs to audit (placeholder logger.info — real audit service in Phase Group 6)

**Acceptance:**

- Admin can change user status from PENDING_PROFILE to SUSPENDED
- Admin can assign `admin` role to a user; user's permissions cache invalidates within 1 second
- Cannot remove super_admin role from bootstrap user → 409 `CANNOT_REMOVE_BOOTSTRAP_ADMIN`
- Regular user → 403

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
and SAZIQO_PLATFORM_PHASES_5_7.md fully. Execute Phase 5B.

Add to UsersService:
- updateStatusByAdmin(userId, newStatus, actorUserId): validates
  transition is allowed (matrix in plan), updates user, invalidates
  cache, logs event
- assignRoleByAdmin(userId, roleId, scope, actorUserId): delegates to
  permissionsService.assignRoleToUser, logs event
- removeRoleByAdmin(userId, roleId, actorUserId): guard — read
  SUPER_ADMIN_PHONE from config, find that user; if userId matches and
  roleId is super_admin's, throw ConflictException with code
  CANNOT_REMOVE_BOOTSTRAP_ADMIN. Otherwise proceed.

Add UsersController endpoints:
- @Patch('admin/users/:id') @RequirePermission('admin:update:user')
  Zod body: { status?: UserStatus, firstName?: string,
  lastName?: string, email?: string }
- @Post('admin/users/:id/roles') @RequirePermission('admin:moderate:user')
  Zod body: { roleId: bigint, scope?: any }
- @Delete('admin/users/:id/roles/:roleId') @RequirePermission(
  'admin:moderate:user')

Add error code: CANNOT_REMOVE_BOOTSTRAP_ADMIN.

Cache invalidation: after each mutation, redis.del("user:permissions:
{userId}") and redis.del("user:status:{userId}").

Audit (placeholder): logger.info({ event: 'ADMIN_USER_UPDATE',
actorUserId, targetUserId, changes }) — real audit service replaces
this in Phase 6B.

Integration tests: status transition, role assign/remove, bootstrap
admin protection, cache invalidation timing.

Commit as "feat(phase-5B): add admin user mutation endpoints".
```

---

## Phase 5C: Admin Impersonation Start/Stop + Audited (S3)

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Impersonation is a security risk. Done wrong = privilege escalation. Done right = full traceability.

**Deliverables:**

- New table via migration: `ImpersonationSession`:
  ```prisma
  model ImpersonationSession {
    id              BigInt   @id @default(autoincrement())
    actorUserId     BigInt   // The admin
    targetUserId    BigInt   // The user being impersonated
    sessionId       BigInt?  // Link to admin's original Session
    reason          String   @db.VarChar(500)
    startedAt       DateTime @default(now())
    endedAt         DateTime?
    revokedReason   String?
    @@index([actorUserId])
    @@index([targetUserId])
    @@index([startedAt])
  }
  ```
- `apps/api/src/core/impersonation/impersonation.service.ts`:
  - `start(actorUserId, targetUserId, reason)` — creates ImpersonationSession, issues a NEW JWT pair where `sub` = targetUserId, payload includes `imp: { actorUserId, impersonationSessionId }`
  - `stop(impersonationSessionId, actorUserId)` — sets `endedAt`, returns acknowledgement
  - `findActive(actorUserId)` — current impersonation session if any
- Endpoints:
  - `POST /api/v1/admin/impersonation/start` — `@AdminOnly({ confirmHeader: true })` — body: `{ targetUserId, reason }`. Returns NEW token pair targeted at the impersonated user.
  - `POST /api/v1/admin/impersonation/stop` — JWT (impersonation token), terminates the impersonation session
  - `GET /api/v1/admin/impersonation/active` — `@RequirePermission('admin:impersonate:user')` — current actor's active impersonation
- JwtAuthGuard updated: if `imp` claim present, attach `request.impersonation = { actorUserId, sessionId }` alongside `request.user` (which becomes the target user). Audit middleware uses both.
- Restrictions:
  - Cannot impersonate another super_admin (returns 403 `CANNOT_IMPERSONATE_SUPER_ADMIN`)
  - Cannot nest impersonation (an impersonation token cannot start a new impersonation → 409)
  - Reason field is mandatory and stored (operational accountability)
- After impersonation stop, target user receives an in-app notification (placeholder via logger; real notification in Phase Group 8): "حساب کاربری شما توسط پشتیبانی در تاریخ {date} برای {duration} دقیقه دسترسی داشت."

**Acceptance:**

- Admin starts impersonation → new tokens, claims include `imp`
- Impersonation token used on protected endpoint → request.user is target, request.impersonation has actor info
- Stop → session ended, can no longer use impersonation tokens
- Cannot impersonate super_admin → 403
- Cannot nest → 409
- All actions logged via placeholder (real audit in 6B)

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
and SAZIQO_PLATFORM_PHASES_5_7.md fully. Execute Phase 5C.

Add Prisma migration for ImpersonationSession table per the plan schema.

Build apps/api/src/core/impersonation/:
- impersonation.module.ts
- impersonation.service.ts:
  - start(actorUserId, targetUserId, reason): validates target is not
    super_admin (lookup roles); creates ImpersonationSession; issues
    new JWT pair via SessionsService.issueImpersonationTokens (new
    method) where payload sub=targetUserId, imp={actorUserId, impSessionId}
  - stop(impSessionId, actorUserId): verifies actor owns session, sets
    endedAt
  - findActive(actorUserId): returns current active or null

Add to SessionsService:
- issueImpersonationTokens(actorUserId, targetUserId, impSessionId,
  userAgent, ipAddress): similar to issueTokens but JWT payload includes
  imp claim. Refresh token still valid 30 days but the impersonation
  session can be ended early via stop().

Update JwtAuthGuard: if jwt.imp present, set request.impersonation =
{ actorUserId: BigInt, impSessionId: BigInt }; request.user.id remains
sub (the target). Verify ImpersonationSession.endedAt is null on every
request — if not, throw UNAUTHORIZED with code IMPERSONATION_ENDED.

Add ImpersonationController:
- @Post('admin/impersonation/start') @AdminOnly({confirmHeader: true})
  @Idempotent() body: { targetUserId, reason: string min 10 chars }
- @Post('admin/impersonation/stop') — requires JWT with imp claim
- @Get('admin/impersonation/active') @RequirePermission(
  'admin:impersonate:user')

Restrictions:
- targetUserId super_admin → 403 CANNOT_IMPERSONATE_SUPER_ADMIN
- Caller already in impersonation (request.impersonation exists) → 409
  CANNOT_NEST_IMPERSONATION

Add error codes: CANNOT_IMPERSONATE_SUPER_ADMIN, CANNOT_NEST_IMPERSONATION,
IMPERSONATION_ENDED.

Notification on stop: logger.info({ event: 'IMPERSONATION_ENDED',
targetUserId, actorUserId, durationSeconds, reason }) — real notification
in Phase Group 8.

Integration tests:
- Admin starts → tokens with imp claim → uses → stops
- Cannot impersonate super_admin
- Cannot nest
- After stop, impersonation token no longer works
- Reason field required and persisted

Commit as "feat(phase-5C): add admin impersonation with audit (S3)".
```

---

## Test Gate 5: Users + Impersonation Verification

**Model: 🔴 Opus**

- [ ] `GET /admin/users` returns paginated list for admin, 403 for regular user
- [ ] Filters work: status, search, roleId, date ranges
- [ ] `PATCH /admin/users/:id` updates status correctly
- [ ] Role assign/remove invalidates permission cache
- [ ] Cannot remove super_admin role from bootstrap user → 409
- [ ] Phone is immutable
- [ ] Impersonation start: admin token in, new tokens out with `imp` claim
- [ ] Impersonation request: `request.user` is target, `request.impersonation` is actor
- [ ] Cannot impersonate super_admin → 403
- [ ] Cannot nest impersonation → 409
- [ ] Stop ends the session; old impersonation token rejected
- [ ] All admin mutations log via placeholder (`logger.info` with structured event)
- [ ] No console errors during full flow

---

# Phase Group 6 — Audit Log

## Phase 6A: Audit Log Service + Append-Only Enforcement

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** Audit log is the source of truth for compliance and incident response. Mutability or gaps are catastrophic.

**Deliverables:**

- Migration: ensure `AuditLog` table from Phase 2B has all columns. Add `payloadHash VARCHAR(64) NOT NULL` if not already present.
- DB-level append-only enforcement:
  - PostgreSQL trigger via SQL migration that raises an exception on UPDATE or DELETE on `audit_log` table
  - Migration file: `prisma/migrations/{timestamp}_audit_log_append_only/migration.sql` containing:

    ```sql
    CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'audit_log table is append-only — % not permitted', TG_OP;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();

    CREATE TRIGGER audit_log_no_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();
    ```

- `apps/api/src/core/audit/audit.module.ts`
- `apps/api/src/core/audit/audit.service.ts`:
  - `log(entry: AuditEntry)` — async, fire-and-forget from caller, but service awaits internally to ensure write-through
  - `findMany(filters, pagination)` — admin-facing; filters by actorUserId, action, resource, resourceId, dateRange
  - `findById(id)` — single entry detail
- `AuditEntry` type:
  ```typescript
  interface AuditEntry {
    actorUserId: bigint | null; // null for system actions
    action: string; // e.g. 'USER_STATUS_CHANGED'
    resource: string; // e.g. 'user'
    resourceId: bigint | null;
    payload: Record<string, unknown>; // arbitrary structured data
    ipAddress: string | null;
    userAgent: string | null;
    impersonationSessionId?: bigint; // if action happened during impersonation
  }
  ```
- `payloadHash` is sha256 of canonical JSON of payload (sorted keys) — for tamper detection
- All sensitive fields redacted before storage: phone numbers masked except last 4, refresh tokens never logged, OTP codes never logged
- Standard action codes catalog in `apps/api/src/core/audit/actions.catalog.ts`:
  ```typescript
  export const AUDIT_ACTIONS = {
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
    SIGNUP_SUCCESS: 'SIGNUP_SUCCESS',
    LOGOUT: 'LOGOUT',
    PROFILE_COMPLETED: 'PROFILE_COMPLETED',
    SESSION_REVOKED: 'SESSION_REVOKED',
    SESSION_REPLAY_DETECTED: 'SESSION_REPLAY_DETECTED',
    ADMIN_USER_UPDATE: 'ADMIN_USER_UPDATE',
    ADMIN_USER_STATUS_CHANGED: 'ADMIN_USER_STATUS_CHANGED',
    ADMIN_ROLE_ASSIGNED: 'ADMIN_ROLE_ASSIGNED',
    ADMIN_ROLE_REMOVED: 'ADMIN_ROLE_REMOVED',
    IMPERSONATION_STARTED: 'IMPERSONATION_STARTED',
    IMPERSONATION_ENDED: 'IMPERSONATION_ENDED',
    PERMISSION_GRANTED: 'PERMISSION_GRANTED',
    PERMISSION_REVOKED: 'PERMISSION_REVOKED',
    MAINTENANCE_TOGGLED: 'MAINTENANCE_TOGGLED',
    // Module-level actions added by modules via registerAuditActions
  } as const;
  ```

**Acceptance:**

- Calling `audit.log(entry)` writes a row with `payloadHash` populated
- Manual UPDATE attempt via psql → fails with trigger error
- Manual DELETE attempt → fails
- Sensitive payload fields are redacted in stored row (verified by reading back and grep)
- Phone numbers masked to `+98****1234` format

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
and SAZIQO_PLATFORM_PHASES_5_7.md fully. Execute Phase 6A.

Create a new Prisma migration named "audit_log_append_only" that adds
the PostgreSQL trigger from the plan. Use --create-only flag, then add
the SQL by hand inside the migration file (Prisma supports raw SQL in
migration.sql). Apply with db:migrate-dev.

If AuditLog table from Phase 2B doesn't yet have payloadHash column,
add via the same migration: ALTER TABLE audit_log ADD COLUMN
payload_hash VARCHAR(64) NOT NULL DEFAULT '' — but since we may already
have rows, default empty then set NOT NULL after backfill (or just use
NULLable in v1 — fresh DB has no rows yet). For dev, simplest: drop
the table and recreate via migrate reset.

Build apps/api/src/core/audit/:
- audit.module.ts
- audit.service.ts:
  - log(entry: AuditEntry): redacts sensitive fields, computes
    payloadHash = sha256(canonicalJSON(payload)), inserts via Prisma
  - findMany(filters, pagination): cursor-based, filters per plan
  - findById(id)
- actions.catalog.ts: AUDIT_ACTIONS const as listed in plan
- redaction.ts: helper that redacts known sensitive paths in payload —
  phone (mask), refreshToken (omit), otpCode (omit), nationalId (mask
  to last 4)

Replace placeholder logger.info calls in:
- AuthService.verifyOtp (LOGIN_SUCCESS / SIGNUP_SUCCESS)
- SessionsService.rotateRefreshToken on replay (SESSION_REPLAY_DETECTED)
- UsersService.completeProfile (PROFILE_COMPLETED)
- UsersService.updateStatusByAdmin (ADMIN_USER_STATUS_CHANGED)
- ImpersonationService.start (IMPERSONATION_STARTED)
- ImpersonationService.stop (IMPERSONATION_ENDED)

For each replacement, the audit.log call is fire-and-forget from a
controller's perspective but awaited internally to guarantee write-through.

Unit tests:
- log() writes row with correct payloadHash
- redaction strips phone/token/otp correctly
- canonical JSON produces stable hashes for reordered objects

Integration test (raw SQL via prisma.$executeRaw):
- Attempt UPDATE on audit_log → expect Prisma to throw with trigger error
- Attempt DELETE on audit_log → same

Commit as "feat(phase-6A): add audit log service with append-only enforcement".
```

---

## Phase 6B: Audit Middleware (log every privileged action)

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** Coverage is the value of an audit log. Missing actions = blind spots.

**Deliverables:**

- `apps/api/src/common/interceptors/audit.interceptor.ts` — global interceptor that:
  - Reads metadata `audit:action` set by `@Audit()` decorator
  - On successful response, calls `audit.log(...)` with actor (request.user.id), action, resource, resourceId (extracted from response or path), payload (request body, sanitized)
  - On failure (4xx/5xx), still logs the attempted action with `failed: true` flag
- `apps/api/src/common/decorators/audit.decorator.ts`:
  - `@Audit({ action: AUDIT_ACTIONS.X, resource: 'user', resourceIdParam?: 'id' })` — declares an endpoint as audit-tracked
  - `resourceIdParam` says where to find the resource ID (path param, body field, response field)
- Apply to:
  - All admin mutation endpoints (replace ad-hoc audit.log calls in services with declarative decorator)
  - All security-sensitive endpoints: login, logout, refresh, profile completion, password actions (none in v1), TOTP (none in v1)
- Impersonation context: when audit interceptor sees `request.impersonation`, the entry's `actorUserId` is the impersonator's id and the payload includes `impersonationSessionId`

**Acceptance:**

- Every endpoint marked with `@Audit()` produces an audit row on success
- Failed requests (4xx) still produce an audit row with `failed: true`
- During impersonation, audit row's actor is the admin, not the target
- Audit rows from auth flow appear: signup, login, logout, refresh, profile completion
- Audit rows from admin flow appear: user mutations, role changes, impersonation

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
and SAZIQO_PLATFORM_PHASES_5_7.md fully. Execute Phase 6B.

Build apps/api/src/common/decorators/audit.decorator.ts:
- @Audit({ action: string, resource: string, resourceIdParam?: string,
  resourceIdSource?: 'param' | 'body' | 'response' }) sets metadata
  'audit:meta'

Build apps/api/src/common/interceptors/audit.interceptor.ts:
- Reads 'audit:meta' via Reflector
- If absent, skip
- If present:
  - Extract resourceId based on resourceIdSource
  - On observable next: call auditService.log({...}) with success
  - On observable error: call auditService.log({...}) with payload
    including {failed: true, errorCode, statusCode}
  - actorUserId = request.impersonation?.actorUserId ?? request.user?.id
  - If impersonation, payload.impersonationSessionId added

Register AuditInterceptor globally in main.ts AFTER ResponseInterceptor
but BEFORE IdempotencyInterceptor (order: response → audit → idempotency
— audit captures attempts, idempotency caches results).

Apply @Audit() decorator to:
- AuthController: /otp/verify (LOGIN_SUCCESS or SIGNUP_SUCCESS — but the
  catalog has both; logic in interceptor reads response payload to know
  which → simpler: split into action LOGIN_OR_SIGNUP and let payload
  carry the discriminator. CLAUDE: alternative — keep a single AUTH_OTP_VERIFY
  action and put justCreated in payload.)
- AuthController: /refresh → SESSION_REFRESHED
- AuthController: /logout → LOGOUT
- UsersController: /me/complete-profile → PROFILE_COMPLETED
- UsersController: /me/sessions/:id (DELETE) → SESSION_REVOKED
- UsersController: /admin/users/:id (PATCH) → ADMIN_USER_UPDATE
- UsersController: /admin/users/:id/roles (POST) → ADMIN_ROLE_ASSIGNED
- UsersController: /admin/users/:id/roles/:roleId (DELETE) → ADMIN_ROLE_REMOVED
- ImpersonationController: /admin/impersonation/start → IMPERSONATION_STARTED
- ImpersonationController: /admin/impersonation/stop → IMPERSONATION_ENDED

Add new actions to catalog as needed: SESSION_REFRESHED, AUTH_OTP_VERIFY.

Remove the in-service audit.log calls from Phase 6A's replacements that
are now redundant (declarative beats imperative).

Integration tests:
- Each marked endpoint produces an audit row on success
- Failed login (wrong OTP) produces audit row with failed: true
- Admin action during impersonation: audit row's actorUserId is admin's

Commit as "feat(phase-6B): add audit interceptor and decorator".
```

---

## Phase 6C: Admin Audit Log Viewer

**Model: 🟢 Sonnet** | ~150 LOC

**Deliverables:**

- `GET /api/v1/admin/audit` — `@RequirePermission('admin:read:audit_log')`
  - Query params: `actorUserId?`, `action?`, `resource?`, `resourceId?`, `failed?` (boolean), `dateFrom?`, `dateTo?`, `cursor?`, `limit?` (max 100)
  - Returns `{ data: AuditLog[], meta: { cursor, hasMore } }`
- `GET /api/v1/admin/audit/:id` — single entry with full payload
- Search ergonomics: action filter accepts comma-separated list; resource accepts wildcard match
- Response includes resolved actor info (firstName, lastName, phone masked) via JOIN — but only if actor has not been deleted; otherwise show `userId` only

**Acceptance:**

- Admin: `GET /admin/audit?action=LOGIN_SUCCESS&dateFrom=2026-04-01` → filtered list
- Admin: `GET /admin/audit/:id` → full payload
- Pagination works
- Regular user → 403

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
and SAZIQO_PLATFORM_PHASES_5_7.md fully. Execute Phase 6C.

Add to AuditService:
- findManyForAdmin(filters: {actorUserId?, action?, resource?,
  resourceId?, failed?, dateFrom?, dateTo?}, pagination: {cursor?, limit})
  - action filter accepts comma-separated string, splits to IN clause
  - cursor-based by id descending (newest first)
  - Returns { items, nextCursor, hasMore }
  - LEFT JOIN users on actorUserId, returns actor object or null if
    user soft-deleted
- findByIdForAdmin(id): full row + actor join

Add AuditController:
- @Get('admin/audit') @RequirePermission('admin:read:audit_log')
- @Get('admin/audit/:id') @RequirePermission('admin:read:audit_log')

Zod query schema with cursor (bigint), limit (1-100, default 50).

Sanitize response: actor object includes id, firstName, lastName,
phone masked +98****1234. Never expose nationalId or email in audit
list (could leak in logs).

Integration tests:
- Admin: lists audit entries with filters
- Pagination cursor works
- Regular user: 403
- Deleted actor still shows the userId but actor object is null

Commit as "feat(phase-6C): add admin audit log viewer".
```

---

## Test Gate 6: Audit Log Verification

**Model: 🔴 Opus**

- [ ] Append-only triggers prevent UPDATE and DELETE
- [ ] Login flow produces 1 audit row per success
- [ ] Failed login (wrong OTP) produces 1 audit row with `failed: true`
- [ ] Refresh, logout, profile completion all produce audit rows
- [ ] Admin user mutations produce audit rows
- [ ] Impersonation start/stop produce audit rows
- [ ] During impersonation, downstream actions log actor=admin in audit
- [ ] Sensitive fields redacted (phone masked, no OTP/refresh-token)
- [ ] `payloadHash` is consistent for same payload (canonical JSON)
- [ ] `GET /admin/audit` returns paginated list with filters
- [ ] Regular user → 403 on audit endpoints

---

# Phase Group 7 — File Storage

## Phase 7A: FileStore Interface + LocalFileStore Implementation

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** File handling is a top attack vector. Path traversal, MIME spoofing, oversized uploads — all critical.

**Deliverables:**

- `apps/api/src/core/files/file-store.interface.ts`:

  ```typescript
  export interface FileStore {
    name: string;
    put(input: PutFileInput): Promise<StoredFile>;
    get(path: string): Promise<NodeJS.ReadableStream>;
    head(path: string): Promise<FileMetadata | null>;
    delete(path: string): Promise<void>;
  }

  export interface PutFileInput {
    buffer: Buffer;
    originalName: string;
    mimeType: string; // verified via sniffing, not trusted from client
    ownerUserId: bigint;
  }

  export interface StoredFile {
    path: string; // relative storage path
    sha256: string;
    size: number;
    mimeType: string;
  }

  export interface FileMetadata {
    size: number;
    mimeType: string;
    sha256: string;
    storedAt: Date;
  }
  ```

- `apps/api/src/core/files/local-file-store.ts` implementing `FileStore`:
  - Storage root from env `FILE_STORAGE_ROOT` (default `/var/saziqo-platform/files`)
  - Path strategy: `uploads/{yyyy}/{mm}/{dd}/{sha256[0:2]}/{sha256[2:4]}/{sha256}.{ext}`
  - Atomic writes: write to `temp/{uuid}.{ext}` then rename to final path
  - `put()` computes sha256 streaming, deduplicates (if path already exists with same sha256, return existing)
  - `get()` returns read stream (caller pipes to response)
  - All path operations sanitized — no `..`, no absolute paths from input
- `apps/api/src/core/files/files.module.ts` — provides `FileStore` token bound to `LocalFileStore`
- Add to `.env.example`: `FILE_STORAGE_ROOT=/var/saziqo-platform/files`, `MAX_UPLOAD_SIZE_MB=10`

**Acceptance:**

- `put()` writes file to date-partitioned path
- Same buffer uploaded twice → second call returns same path (dedup)
- Path traversal attempts (`originalName="../../etc/passwd"`) sanitized
- `get()` returns stream that produces identical bytes
- `delete()` removes file (soft-delete via DB; physical delete in v1.5)

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
and SAZIQO_PLATFORM_PHASES_5_7.md fully. Execute Phase 7A.

Build apps/api/src/core/files/:
- file-store.interface.ts: types per the plan
- local-file-store.ts: LocalFileStore class implementing FileStore
- files.module.ts: provides FileStore token

LocalFileStore.put logic:
1. Compute sha256 from buffer (streaming-safe via createHash)
2. Determine extension from MIME (use mime-types package): jpeg → .jpg,
   png → .png, pdf → .pdf, etc. Reject unknown MIME (controller layer
   already filtered by allow-list, but defense in depth).
3. Build storage path: uploads/YYYY/MM/DD/{sha256[0:2]}/{sha256[2:4]}/
   {sha256}.{ext}
4. Check if file exists at target path:
   - If yes and size matches → return {path, sha256, size, mimeType}
     (dedup hit)
   - If no → write to temp/{uuid}.{ext} then atomic rename to final
5. Set file permissions 0640 (owner read/write, group read, others none)
6. Return StoredFile

LocalFileStore.get: fs.createReadStream(absolutePath). Verify path is
inside FILE_STORAGE_ROOT (prevent traversal). Throw NOT_FOUND if missing.

LocalFileStore.head: fs.stat + read first bytes for MIME re-verify if
metadata not in DB. Used by integrity checks.

LocalFileStore.delete: physical delete deferred to v1.5; for now, this
method just logs ("DELETE not implemented in v1, soft-delete via DB").

Add config: FILE_STORAGE_ROOT (default /var/saziqo-platform/files for
prod, ./tmp/saziqo-files for dev), MAX_UPLOAD_SIZE_MB (default 10).

In dev, ensure ./tmp/saziqo-files/ is created on app boot if missing
and added to .gitignore.

Unit tests:
- put() creates file at expected path
- Dedup: two put() calls with same buffer return same path
- Path traversal: originalName "../../etc/passwd" still gets stored
  inside FILE_STORAGE_ROOT (because the path is built from sha256, not
  originalName — but verify originalName is preserved separately)
- get() returns stream with identical bytes

Commit as "feat(phase-7A): add file store interface and local implementation".
```

---

## Phase 7B: Upload Endpoint + MIME Sniffing + Size Limits

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Upload endpoint is the ingress for files. MIME spoofing or oversized uploads must be rejected here, not later.

**Deliverables:**

- Install `multer` (Express middleware, comes with NestJS), `file-type` (MIME sniffing)
- `apps/api/src/core/files/files.service.ts`:
  - `upload(input)` — validates size, sniffs MIME, calls FileStore.put, writes File row to DB
  - `findById(id)` — returns File row + ownership check
  - `softDelete(id, userId)` — sets `deletedAt`
- `POST /api/v1/files/upload` — JWT required, multipart form upload:
  - Field name: `file`
  - Optional field: `purpose` (string, e.g. `"avatar"`, `"document"`) — used to scope MIME allow-list
  - Validates: size ≤ MAX_UPLOAD_SIZE_MB, MIME ∈ allow-list-for-purpose
  - Stores via FileStore, persists row in `files` table
  - Returns `{ data: { id, path, size, mimeType, originalName } }`
- MIME allow-list per purpose, configurable in `apps/api/src/core/files/mime-policy.ts`:
  ```typescript
  export const MIME_ALLOWLIST_BY_PURPOSE: Record<string, string[]> = {
    avatar: ['image/jpeg', 'image/png', 'image/webp'],
    document: ['application/pdf'],
    image: ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'],
    archive: ['application/zip'],
    text: ['text/plain', 'text/markdown'],
  };
  ```
- SVG handling: when `image/svg+xml` is in allow-list, sanitize via DOMPurify on the server (strip scripts, event handlers). If sanitization removes content → reject with `SVG_UNSAFE_CONTENT`.
- Audit: `@Audit({ action: 'FILE_UPLOADED', resource: 'file' })`
- Per-route upload size override decorator: `@MaxUploadSize(50)` → 50 MB (used by modules later)

**Acceptance:**

- Upload 5 MB JPEG with `purpose=avatar` → 200, file row created
- Upload 11 MB file → 413 `FILE_TOO_LARGE`
- Upload `.exe` renamed to `.jpg` (real MIME application/x-msdownload, claimed image/jpeg) → MIME sniff catches it, 400 `MIME_NOT_ALLOWED`
- Upload SVG with `<script>` → sanitized; if sanitization changes content materially, rejected
- Upload without `purpose` → defaults to most restrictive allow-list (`document` only)
- Upload without auth → 401

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
and SAZIQO_PLATFORM_PHASES_5_7.md fully. Execute Phase 7B.

Install: multer (already with @nestjs/platform-express), file-type,
isomorphic-dompurify, mime-types.

Build apps/api/src/core/files/files.service.ts:
- upload(input: { buffer, originalName, claimedMimeType, ownerUserId,
  purpose }):
  1. Validate size ≤ MAX_UPLOAD_SIZE_MB (or per-route override)
  2. Sniff MIME via fileTypeFromBuffer(buffer). If sniffed MIME differs
     materially from claimedMimeType → throw MIME_MISMATCH (compare
     base type, not exact)
  3. Validate sniffed MIME ∈ MIME_ALLOWLIST_BY_PURPOSE[purpose]. If
     purpose missing, default to 'document' (most restrictive).
  4. If MIME is image/svg+xml: sanitize via DOMPurify; if output differs
     materially → SVG_UNSAFE_CONTENT
  5. Call FileStore.put({ buffer, originalName, mimeType: sniffedMime,
     ownerUserId })
  6. Insert File row { ownerUserId, path, originalName, mimeType,
     size, sha256 }
  7. Return File row

- findById(id, currentUserId): returns File row, throws NOT_FOUND if
  missing or owner mismatch (unless admin permission)

- softDelete(id, userId): sets deletedAt = now after ownership check

Build mime-policy.ts per the plan.

Build apps/api/src/common/decorators/max-upload-size.decorator.ts:
- @MaxUploadSize(megabytes: number) sets metadata 'upload:maxSizeMb'

Build apps/api/src/core/files/upload.interceptor.ts:
- Wraps multer FileInterceptor with dynamic limits based on @MaxUploadSize
  metadata, falling back to MAX_UPLOAD_SIZE_MB

Add FilesController:
- @Post('files/upload')
  @UseInterceptors(uploadInterceptor)
  @Audit({ action: 'FILE_UPLOADED', resource: 'file' })
  Body: multipart with 'file' field + optional 'purpose' string
  Calls filesService.upload, returns sanitized File row

Add error codes: FILE_TOO_LARGE, MIME_NOT_ALLOWED, MIME_MISMATCH,
SVG_UNSAFE_CONTENT.

Integration tests:
- 5 MB JPEG with purpose=avatar → 200
- 11 MB file → 413 FILE_TOO_LARGE
- .exe renamed .jpg with claimed image/jpeg → MIME_MISMATCH
- SVG with <script> tag → sanitized or rejected
- Without auth → 401
- Without purpose → defaults to document

Commit as "feat(phase-7B): add upload endpoint with mime sniffing and size limits".
```

---

## Phase 7C: Download Endpoint with Permission Check

**Model: 🟢 Sonnet** | ~150 LOC

**Deliverables:**

- `GET /api/v1/files/:id/download`
  - JWT required
  - Permission check: requester must be owner OR have `admin:read:any_file` permission (add to catalog)
  - Streams file via FileStore.get
  - Sets `Content-Type` from File row, `Content-Length`, `Content-Disposition: attachment; filename="{originalName}"`
  - For images, allow inline display: query param `?inline=true` → `Content-Disposition: inline`
- `GET /api/v1/files/:id` (metadata only, no body) — same permission rules
- Soft-deleted files (`deletedAt IS NOT NULL`) → 410 `GONE`

**Add new permission code:** `admin:read:any_file`

**Acceptance:**

- Owner downloads own file → 200 with stream, correct Content-Type
- Non-owner downloads → 403
- Admin with permission downloads → 200
- Soft-deleted file → 410
- Missing file → 404
- Range requests not supported in v1 (defer to v1.5 if streaming video needed)

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
and SAZIQO_PLATFORM_PHASES_5_7.md fully. Execute Phase 7C.

Add to permissions catalog: 'admin:read:any_file' (description: 'Read
any file regardless of ownership').

Re-seed via Bootstrap.

Add to FilesService:
- streamForDownload(id, currentUserId, hasAdminAccess): looks up File,
  if deletedAt set throw GoneException, if owner mismatch and !hasAdminAccess
  throw ForbiddenException, returns { stream, mimeType, originalName, size }

Add FilesController:
- @Get('files/:id') @Audit({ action: 'FILE_METADATA_READ', resource:
  'file', resourceIdParam: 'id' })
  Returns sanitized File row (no path, just public fields)
- @Get('files/:id/download') @Audit({ action: 'FILE_DOWNLOADED',
  resource: 'file', resourceIdParam: 'id' })
  Query: ?inline=true (boolean default false)
  Streams file with appropriate headers
  Permission check inside service (owner or admin permission)

For permission check inside service, use permissionsService.userHasPermission
(currentUserId, 'admin:read:any_file').

Add error code: GONE (HTTP 410) — already standard, just ensure error
filter handles it.

Integration tests:
- Owner downloads → 200 with bytes matching upload
- Non-owner → 403
- Admin with permission → 200
- Soft-deleted → 410
- Missing → 404
- inline=true → Content-Disposition: inline

Commit as "feat(phase-7C): add file download endpoint with permission check".
```

---

## Test Gate 7: File Storage Verification

**Model: 🔴 Opus**

- [ ] Upload JPEG (5 MB, purpose=avatar) → 200, file persisted at expected path
- [ ] Upload >10 MB → 413 `FILE_TOO_LARGE`
- [ ] MIME spoofing (.exe as .jpg) → rejected
- [ ] SVG with `<script>` sanitized or rejected
- [ ] Same file uploaded twice → deduplicated (same path)
- [ ] Owner downloads own file → 200 with correct bytes
- [ ] Non-owner → 403
- [ ] Admin with `admin:read:any_file` → 200
- [ ] Soft-deleted file → 410
- [ ] Path traversal in `originalName` → still stored safely under FILE_STORAGE_ROOT
- [ ] Audit log shows FILE_UPLOADED and FILE_DOWNLOADED entries

---

# What Comes After Phase Group 7

After Test Gate 7, you have:

- Full user management (read, mutate, role assign, impersonate)
- Append-only audit log with 15+ tracked actions and admin viewer
- File storage with strict MIME/size limits and permission-checked downloads

**Ready for:** any module that needs files (agent bundles, template archives, profile images), audit-traceable operations, and admin-controlled user management.

**Next:** Phase Groups 8–10 (Notifications, Internal Ledger, Payments) — `platform-phases-8-10.md`.
