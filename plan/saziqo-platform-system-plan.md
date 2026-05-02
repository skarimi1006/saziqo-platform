# سازیکو Platform — System Skeleton Plan

## Project Identity

- **Project:** `saziqo-platform` — the multi-module business platform at `app.saziqo.ir`
- **Scope of THIS plan:** **System layer only** (skeleton). No business modules included. Modules are planned separately.
- **Architecture:** Modular monolith (NestJS API + Next.js frontend, single deployable)
- **Language:** Persian (فارسی) only — RTL — English allowed in code comments and CLAUDE.md only
- **Audience:** Iranian developers, makers, businesses building with AI
- **Developer:** Claude Code (all phases)
- **Maintainer:** Saeed (CEO)
- **Constraint:** **Open-source self-hosted only** — no paid SaaS dependencies for runtime services

---

## Locked Decision Contract

| #   | Property                 | Value                                                                |
| --- | ------------------------ | -------------------------------------------------------------------- |
| 1   | Backend                  | NestJS (TypeScript, MIT)                                             |
| 2   | Frontend                 | Next.js 15 App Router + Tailwind + shadcn/ui (all MIT)               |
| 3   | Architecture             | Modular monolith, single deployable                                  |
| 4   | Database                 | PostgreSQL 16 (self-hosted)                                          |
| 5   | Cache / Queue / Sessions | Redis 7 + BullMQ (self-hosted)                                       |
| 6   | Search                   | Meilisearch (self-hosted, MIT)                                       |
| 7   | ORM                      | Prisma + Prisma Migrate (no Accelerate, no Pulse)                    |
| 8   | Package manager          | pnpm                                                                 |
| 9   | Monorepo                 | Turborepo (no remote cache)                                          |
| 10  | Auth                     | Custom-built — phone + SMS OTP only — TOTP for super_admin           |
| 11  | Payments                 | ZarinPal (abstracted, credentials provided later)                    |
| 12  | SMS                      | Iranian provider abstracted (credentials provided later)             |
| 13  | Email                    | **Deferred to v1.5** — only abstraction + console adapter built      |
| 14  | File storage             | Local FS at `/var/saziqo-platform/files/` behind FileStore interface |
| 15  | Reverse proxy            | Caddy (Apache-2.0)                                                   |
| 16  | Container                | Docker + Docker Compose                                              |
| 17  | Error tracking           | Self-hosted GlitchTip OR structured logs to file                     |
| 18  | Uptime monitoring        | Self-hosted Uptime Kuma (deferred to v1.5)                           |
| 19  | Hosting                  | Iranian VPS, separate from website server                            |
| 20  | Theme                    | Light/white + brand orange `#f97316` + saziqo logo                   |
| 21  | RTL                      | Throughout                                                           |
| 22  | Code comments            | English allowed in source; **stripped at release**                   |
| 23  | CLAUDE.md files          | Allowed in source; **stripped at release**                           |
| 24  | Module migration         | Strict contract + table prefix + event bus                           |
| 25  | Reliability              | Append-only migrations, idempotency, contract tests                  |
| 26  | S1–S8                    | All accepted (see "Strategic Suggestions" below)                     |
| 27  | National ID              | Validated by Iranian checksum algorithm                              |
| 28  | Profile completion       | Mandatory gate after first OTP login                                 |

### Strategic suggestions (S1–S8) — all accepted

- **S1** — Module enable/disable feature flags at runtime
- **S2** — Soft-launch / beta access flags per user
- **S3** — Admin impersonation (audited)
- **S4** — Read-replica plumbing from day one
- **S5** — Per-endpoint rate-limit profiles
- **S6** — Admin-only dangerous endpoints with explicit confirm header
- **S7** — i18n pipeline ready (Persian-only in v1)
- **S8** — Operational kill-switch via Redis flag

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                       Internet                                │
└──────────────────┬─────────────────────────┬──────────────────┘
                   │                         │
        ┌──────────▼──────────┐    ┌─────────▼──────────┐
        │ Caddy (TLS + WAF)   │    │ ZarinPal callback  │
        │ Reverse proxy       │    │ webhook            │
        └──────────┬──────────┘    └─────────┬──────────┘
                   │                         │
        ┌──────────▼─────────────────────────▼──────────┐
        │  Next.js (app.saziqo.ir)                       │
        │  Public pages SSR + Auth UI + Account          │
        │  Admin shell (role-gated)                      │
        └──────────────────┬─────────────────────────────┘
                           │  REST + WebSocket
        ┌──────────────────▼─────────────────────────────┐
        │  NestJS API (single binary)                    │
        │  ┌──────────────────────────────────────────┐  │
        │  │  CORE (system layer — THIS PLAN)         │  │
        │  │  auth · rbac · users · files · notif ·   │  │
        │  │  audit · ledger · payments · search ·    │  │
        │  │  realtime · jobs · admin · settings ·    │  │
        │  │  module-registry · health · i18n         │  │
        │  └──────────────────────────────────────────┘  │
        │  ┌──────────────────────────────────────────┐  │
        │  │  MODULES (separate plans, not here)      │  │
        │  │  agents · builders · templates · tools · │  │
        │  │  devops · security · …                   │  │
        │  └──────────────────────────────────────────┘  │
        └──────┬─────────────┬──────────────┬────────────┘
               │             │              │
        ┌──────▼─────┐ ┌────▼─────┐ ┌──────▼──────┐
        │ PostgreSQL │ │  Redis   │ │ Meilisearch │
        │     16     │ │ sess+q+c │ │  search     │
        └────────────┘ └──────────┘ └─────────────┘
               │
        ┌──────▼──────────────┐
        │ Local FS            │
        │ /var/saziqo/files/  │
        └─────────────────────┘
```

---

## Module Contract (every module implements this)

```typescript
// CLAUDE: This is the canonical module contract. Every business module
// (agents, builders, templates, tools, devops, security, ...) implements
// this interface. The system registry discovers modules at boot, runs
// their migrations, mounts their routes, and registers their permissions,
// jobs, search indexes, admin pages, and notification templates.

export interface PlatformModule {
  // Identity
  readonly name: string; // e.g. "agents"
  readonly persianName: string; // e.g. "ایجنت‌ها"
  readonly version: string; // semver

  // Registration (called by registry at boot)
  registerRoutes(router: NestRouter, deps: ModuleDeps): void;
  registerPermissions(): Permission[];
  registerMigrations(): Migration[];
  registerJobs?(queue: QueueRegistry): void;
  registerSearchIndexes?(meili: MeiliClient): Promise<void>;
  registerAdminPages?(): AdminPageDefinition[];
  registerNotificationTemplates?(): NotificationTemplate[];
  registerEventListeners?(bus: EventBus): void;

  // Lifecycle
  onInstall?(deps: ModuleDeps): Promise<void>;
  onBoot?(deps: ModuleDeps): Promise<void>;
  onShutdown?(deps: ModuleDeps): Promise<void>;
}

export interface ModuleDeps {
  prisma: PrismaClient;
  redis: RedisClient;
  fileStore: FileStore;
  ledger: LedgerService;
  payments: PaymentService;
  notifications: NotificationService;
  audit: AuditService;
  search: SearchService;
  realtime: RealtimeService;
  jobs: JobService;
  config: ConfigService;
  events: EventBus;
  i18n: I18nService;
  logger: Logger;
}
```

**Module rules (enforced by lint + tests):**

1. Modules own their database tables via prefix: `agents_listings`, `builders_projects`, `tools_subscriptions`. **No table is shared across modules.**
2. Modules communicate via the **event bus**, not direct service-to-service calls. The agents module emits `payment.completed`; the ledger module subscribes.
3. Modules can import from `core/*` and `common/*`. Modules CANNOT import from other modules.
4. Modules can be enabled/disabled per-environment via config flag (S1).
5. Module routes are mounted under `/api/v1/{moduleName}/...`.
6. Migrations are append-only.

---

## API Conventions (system-enforced)

| Convention     | Rule                                                                  |
| -------------- | --------------------------------------------------------------------- |
| Base path      | `/api/v1/{module}/{resource}`                                         |
| Response shape | `{ data, meta?, error? }` via standardized interceptor                |
| Error shape    | `{ error: { code, message, details? } }`                              |
| Validation     | Zod schemas via `nestjs-zod`, reject unknown properties               |
| Auth           | JWT bearer in `Authorization` header; refresh in HttpOnly cookie      |
| Pagination     | Cursor-based `?cursor=...&limit=...`                                  |
| Sorting        | `?sort=field:asc,field2:desc`                                         |
| Filtering      | `?filter[field]=value`                                                |
| Idempotency    | All write endpoints accept `Idempotency-Key` header (Redis 24h dedup) |
| Rate limiting  | Per-user + per-IP, Redis-backed, headers expose limits                |
| Locale         | `Accept-Language: fa-IR` default                                      |
| Dates          | UTC ISO 8601 in API; Jalali in UI only                                |
| Currency       | Toman, integer (BIGINT in DB)                                         |
| Phone          | E.164 format `+989XXXXXXXXX` in DB and API                            |
| National ID    | 10-digit string, validated by checksum                                |

---

## Permission Format

`{module}:{action}:{resource}` — examples:

- `users:read:profile`
- `users:update:profile_self`
- `admin:moderate:user`
- `ledger:read:payout`
- `agents:create:listing` (module-defined)
- `builders:approve:bid` (module-defined)

**Default global roles (in core):**

- `super_admin` — everything + TOTP required
- `admin` — operations + moderation, no superuser actions
- `user` — base authenticated user; modules grant additional capabilities
- `viewer` — read-only audit access

Roles are global; permissions are per-module + scoped (`own` vs `any`).

---

## Database Conventions

- All tables snake_case, plural
- All primary keys: `id BIGINT GENERATED ALWAYS AS IDENTITY`
- Every table has `created_at`, `updated_at`, `deleted_at` (soft deletes)
- Every monetary column is `BIGINT` (toman, integer)
- Every foreign key has an index
- Module tables prefixed with module name (`agents_listings`, `tools_subscriptions`)
- Core tables NOT prefixed (`users`, `sessions`, `audit_log`, `ledger_entries`)
- Migrations append-only; lint rule blocks edits to applied migrations

---

## Authentication Flow (LOCKED)

**Single auth method: phone number + SMS OTP.** No passwords.

```
1. User enters Iranian phone (09XXXXXXXXX or +989XXXXXXXXX)
2. System normalizes to E.164 (+989XXXXXXXXX)
3. System sends 6-digit OTP via SMS provider
   - Rate-limited: 1 SMS / 60 sec / phone
   - Max 5 attempts / 24h / phone
   - OTP expires in 2 minutes
   - OTP stored hashed in Redis with TTL
4. User enters OTP
5. System verifies (constant-time comparison)
6. Branch:
   - User EXISTS, status = 'active' → issue session, redirect to dashboard
   - User EXISTS, status = 'pending_profile' → issue session, redirect to profile completion
   - User NEW → create user with status='pending_profile', issue session, redirect to profile completion
7. Profile completion (mandatory gate):
   - First name (نام) — Persian Unicode only
   - Last name (نام خانوادگی) — Persian Unicode only
   - National ID (کد ملی) — 10 digits + checksum validation
   - Email — RFC 5322 + DNS MX check
   - On submit → status = 'active', redirect to dashboard
8. Super_admin only: TOTP enrollment required at first login
```

**Session model:**

- Access token: JWT, 15-minute expiry, returned in body
- Refresh token: opaque random 64-byte string, 30-day expiry, stored in `sessions` table, returned as `HttpOnly Secure SameSite=Strict` cookie
- Refresh-token rotation on every use
- Sessions revocable from admin shell + user's own active-sessions page

---

## Project Structure (target)

```
saziqo-platform/
├── docker-compose.yml
├── docker-compose.dev.yml
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
├── .env.example
├── .nvmrc
├── README.md
├── CLAUDE.md                          # CLAUDE: project context (stripped at release)
│
├── apps/
│   ├── api/                           # NestJS backend
│   │   ├── Dockerfile
│   │   ├── prisma/
│   │   │   ├── schema.prisma          # Core schema only (modules add their own)
│   │   │   └── migrations/
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── core/                  # SYSTEM LAYER
│   │   │   │   ├── auth/
│   │   │   │   ├── rbac/
│   │   │   │   ├── users/
│   │   │   │   ├── sessions/
│   │   │   │   ├── files/
│   │   │   │   ├── notifications/
│   │   │   │   ├── audit/
│   │   │   │   ├── ledger/
│   │   │   │   ├── payments/
│   │   │   │   ├── search/
│   │   │   │   ├── realtime/
│   │   │   │   ├── jobs/
│   │   │   │   ├── settings/
│   │   │   │   ├── events/
│   │   │   │   ├── module-registry/
│   │   │   │   ├── i18n/
│   │   │   │   ├── health/
│   │   │   │   └── admin-shell/
│   │   │   ├── modules/               # MODULES (added by separate plans)
│   │   │   │   └── .gitkeep
│   │   │   ├── common/
│   │   │   │   ├── middleware/
│   │   │   │   ├── interceptors/
│   │   │   │   ├── filters/
│   │   │   │   ├── pipes/
│   │   │   │   ├── decorators/
│   │   │   │   ├── guards/
│   │   │   │   └── types/
│   │   │   └── config/
│   │   │       └── config.module.ts
│   │   └── test/
│   │       ├── e2e/
│   │       └── integration/
│   │
│   └── web/                           # Next.js frontend
│       ├── Dockerfile
│       ├── next.config.mjs
│       ├── src/
│       │   ├── app/
│       │   │   ├── (public)/
│       │   │   ├── (auth)/
│       │   │   ├── (account)/
│       │   │   └── (admin)/
│       │   ├── components/
│       │   │   ├── ui/                # shadcn/ui primitives
│       │   │   ├── layout/
│       │   │   └── shared/
│       │   ├── lib/
│       │   │   ├── api-client.ts
│       │   │   ├── auth.ts
│       │   │   ├── persian.ts
│       │   │   └── i18n.ts
│       │   ├── hooks/
│       │   ├── store/
│       │   └── styles/
│       └── public/
│           └── fonts/vazirmatn/
│
├── packages/
│   ├── shared-types/                  # TypeScript types shared between api & web
│   ├── shared-validators/             # Zod schemas
│   ├── ui/                            # Cross-app component primitives
│   ├── persian-utils/                 # Phone, national ID, Jalali, numeral utilities
│   └── config/                        # Shared eslint, tsconfig, prettier
│
├── infra/
│   ├── caddy/
│   │   └── Caddyfile
│   ├── postgres/
│   │   └── init.sql
│   ├── meilisearch/
│   ├── docker/
│   │   └── compose.prod.yml
│   └── scripts/
│       ├── provision.sh
│       ├── deploy.sh
│       ├── release-build.sh           # Strips CLAUDE.md + comments
│       ├── backup.sh
│       └── harden.sh
│
└── docs/
    ├── architecture.md
    ├── module-contract.md
    ├── api-conventions.md
    ├── auth-flow.md
    ├── security.md
    ├── deployment.md
    └── operations.md
```

---

## Phase Breakdown — Legend

| Symbol    | Meaning                                                    |
| --------- | ---------------------------------------------------------- |
| 🟢        | Sonnet — routine/boilerplate code                          |
| 🔴        | Opus — complex logic, design fidelity, security-critical   |
| ~LOC      | Approximate lines of code (includes markup, schema, tests) |
| Test Gate | Mandatory verification before proceeding                   |

**Per-phase rule:** Hard ceiling of ~200 LOC. Phases that would exceed this are split (A, B, C).

**Per-phase format:** Each phase ends with a Claude Code prompt block — copy-paste ready.

---

## Total Plan Summary

### Phase Group 1 — Monorepo Foundation

| Phase           | Title                                                | Model | ~LOC |
| --------------- | ---------------------------------------------------- | ----- | ---- |
| 1A              | Monorepo scaffold (pnpm + Turborepo + workspaces)    | 🟢    | 120  |
| 1B              | Shared packages (config, tsconfig, eslint, prettier) | 🟢    | 150  |
| 1C              | docker-compose.dev.yml (Postgres + Redis + Meili)    | 🟢    | 130  |
| 1D              | Root CLAUDE.md + repo conventions                    | 🟢    | 120  |
| **Test Gate 1** | **Workspaces install, dev infra boots**              | 🟢    | —    |

### Phase Group 2 — NestJS API Skeleton

| Phase           | Title                                                              | Model | ~LOC |
| --------------- | ------------------------------------------------------------------ | ----- | ---- |
| 2A              | NestJS scaffold + main.ts + app.module + config module             | 🟢    | 180  |
| 2B              | Prisma init + base schema + migration runner                       | 🔴    | 160  |
| 2C              | Common: response interceptor + error filter + Zod pipe             | 🔴    | 200  |
| 2D              | Common: middleware chain (RequestID, Logger, Security, CORS)       | 🔴    | 200  |
| 2E              | Common: rate-limit middleware (Redis-backed, S5 profile decorator) | 🔴    | 200  |
| 2F              | Common: idempotency interceptor (Redis 24h dedup)                  | 🔴    | 150  |
| **Test Gate 2** | **API boots, /health responds, middleware chain verified**         | 🔴    | —    |

### Phase Group 3 — Auth & Sessions

| Phase           | Title                                                              | Model | ~LOC |
| --------------- | ------------------------------------------------------------------ | ----- | ---- |
| 3A              | Users table + Prisma model + migration                             | 🟢    | 150  |
| 3B              | Sessions table + Prisma model + migration                          | 🟢    | 130  |
| 3C              | Phone normalization + Iranian phone validation                     | 🟢    | 100  |
| 3D              | National ID checksum validator                                     | 🟢    | 100  |
| 3E              | OTP service (generate, hash, store in Redis, verify constant-time) | 🔴    | 180  |
| 3F              | SMS provider abstraction + console adapter (no real provider yet)  | 🟢    | 150  |
| 3G              | Auth controller: POST /auth/otp/request                            | 🔴    | 180  |
| 3H              | Auth controller: POST /auth/otp/verify (login + signup branch)     | 🔴    | 200  |
| 3I              | JWT issuer + refresh token rotation                                | 🔴    | 200  |
| 3J              | Auth guard + JWT validation middleware                             | 🔴    | 180  |
| 3K              | Profile completion endpoint + gate middleware                      | 🔴    | 200  |
| 3L              | TOTP for super_admin: enrollment + verification                    | 🔴    | 200  |
| 3M              | Active sessions endpoint + session revocation                      | 🟢    | 150  |
| **Test Gate 3** | **End-to-end auth flow verified, OTP rate limits enforced**        | 🔴    | —    |

### Phase Group 4 — RBAC & Permissions

| Phase           | Title                                                     | Model | ~LOC |
| --------------- | --------------------------------------------------------- | ----- | ---- |
| 4A              | Roles + permissions tables + Prisma models                | 🟢    | 160  |
| 4B              | Permission service (grant, revoke, check)                 | 🔴    | 200  |
| 4C              | RBAC guard + @RequirePermission decorator                 | 🔴    | 180  |
| 4D              | Role seeding (super_admin, admin, user, viewer)           | 🟢    | 120  |
| 4E              | @AdminOnly decorator with X-Admin-Confirm header (S6)     | 🔴    | 130  |
| **Test Gate 4** | **Permissions enforced at all layers, S6 confirm tested** | 🔴    | —    |

### Phase Group 5 — Users Module (Core)

| Phase           | Title                                                 | Model | ~LOC |
| --------------- | ----------------------------------------------------- | ----- | ---- |
| 5A              | Users service + repository (read/write split for S4)  | 🔴    | 200  |
| 5B              | GET /users/me + PATCH /users/me endpoints             | 🟢    | 150  |
| 5C              | Admin: GET /admin/users + filters + pagination        | 🟢    | 180  |
| 5D              | Admin: PATCH /admin/users/:id (status, role)          | 🟢    | 150  |
| 5E              | Admin impersonation (S3) — start/stop + audited       | 🔴    | 200  |
| **Test Gate 5** | **User management works, impersonation audit-logged** | 🔴    | —    |

### Phase Group 6 — Audit Log

| Phase           | Title                                                 | Model | ~LOC |
| --------------- | ----------------------------------------------------- | ----- | ---- |
| 6A              | Audit log table + Prisma model (append-only enforced) | 🔴    | 150  |
| 6B              | Audit service (write only, read via admin)            | 🔴    | 180  |
| 6C              | Audit middleware (log every privileged action)        | 🔴    | 180  |
| 6D              | Admin: GET /admin/audit + filters                     | 🟢    | 150  |
| **Test Gate 6** | **Every privileged action logged, audit immutable**   | 🔴    | —    |

### Phase Group 7 — File Storage

| Phase           | Title                                                  | Model | ~LOC |
| --------------- | ------------------------------------------------------ | ----- | ---- |
| 7A              | FileStore interface + LocalFileStore implementation    | 🔴    | 180  |
| 7B              | Files table + Prisma model + upload endpoint           | 🔴    | 200  |
| 7C              | MIME sniffing + size limits + storage outside web root | 🔴    | 150  |
| 7D              | Download endpoint with permission check                | 🟢    | 150  |
| **Test Gate 7** | **Upload/download work, malicious files rejected**     | 🔴    | —    |

### Phase Group 8 — Notifications

| Phase           | Title                                                            | Model | ~LOC |
| --------------- | ---------------------------------------------------------------- | ----- | ---- |
| 8A              | Notifications table + Prisma model + service                     | 🟢    | 180  |
| 8B              | Email abstraction + console adapter (real SMTP deferred to v1.5) | 🟢    | 150  |
| 8C              | SMS abstraction (reuse from auth) + push to in-app channel       | 🟢    | 150  |
| 8D              | In-app notifications endpoints (list, mark-read)                 | 🟢    | 180  |
| 8E              | Notification templates + i18n integration                        | 🟢    | 150  |
| **Test Gate 8** | **Notifications dispatched, templates render correctly**         | 🟢    | —    |

### Phase Group 9 — Internal Ledger

| Phase           | Title                                                       | Model | ~LOC |
| --------------- | ----------------------------------------------------------- | ----- | ---- |
| 9A              | Ledger entries table (append-only, BIGINT toman)            | 🔴    | 180  |
| 9B              | Ledger service (debit, credit, balance, transfer atomicity) | 🔴    | 200  |
| 9C              | Wallet abstraction (per-user balance)                       | 🔴    | 200  |
| 9D              | Payout queue table + service (manual approval workflow)     | 🔴    | 200  |
| 9E              | Admin: payout queue UI endpoints                            | 🟢    | 180  |
| 9F              | Reconciliation report endpoint (daily totals)               | 🟢    | 150  |
| **Test Gate 9** | **Ledger transactional, no double-spend, balances correct** | 🔴    | —    |

### Phase Group 10 — Payments (ZarinPal Abstraction)

| Phase            | Title                                                 | Model | ~LOC |
| ---------------- | ----------------------------------------------------- | ----- | ---- |
| 10A              | PaymentProvider interface + ZarinPal adapter scaffold | 🔴    | 180  |
| 10B              | Payment initiation endpoint + idempotency             | 🔴    | 200  |
| 10C              | Payment verify callback handler + signature check     | 🔴    | 200  |
| 10D              | Payment-to-ledger event handler                       | 🔴    | 180  |
| 10E              | Refund endpoint (admin-only via S6 confirm)           | 🔴    | 180  |
| **Test Gate 10** | **Mock ZarinPal e2e: init→verify→ledger entry**       | 🔴    | —    |

### Phase Group 11 — Search

| Phase            | Title                                                  | Model | ~LOC |
| ---------------- | ------------------------------------------------------ | ----- | ---- |
| 11A              | Meilisearch client + index registry                    | 🔴    | 180  |
| 11B              | Search service (modules register indexes via contract) | 🔴    | 180  |
| 11C              | Reindex job (BullMQ)                                   | 🟢    | 150  |
| **Test Gate 11** | **Search indexes register, queries return results**    | 🟢    | —    |

### Phase Group 12 — Real-time

| Phase            | Title                                           | Model | ~LOC |
| ---------------- | ----------------------------------------------- | ----- | ---- |
| 12A              | WebSocket gateway (NestJS native, no Pusher)    | 🔴    | 200  |
| 12B              | Auth integration (JWT validation on connect)    | 🔴    | 150  |
| 12C              | Channel registry (modules emit to channels)     | 🔴    | 150  |
| **Test Gate 12** | **Auth-gated WS connections, message delivery** | 🔴    | —    |

### Phase Group 13 — Background Jobs

| Phase            | Title                                                  | Model | ~LOC |
| ---------------- | ------------------------------------------------------ | ----- | ---- |
| 13A              | BullMQ setup + queue registry                          | 🟢    | 150  |
| 13B              | Job runner module + dashboard (Bull-Board self-hosted) | 🟢    | 180  |
| 13C              | Cron scheduler integration                             | 🟢    | 130  |
| **Test Gate 13** | **Jobs queue, run, retry on failure**                  | 🟢    | —    |

### Phase Group 14 — Module Registry & Event Bus

| Phase            | Title                                                     | Model | ~LOC |
| ---------------- | --------------------------------------------------------- | ----- | ---- |
| 14A              | Module contract types + registry service                  | 🔴    | 200  |
| 14B              | Module loader (boot-time discovery)                       | 🔴    | 180  |
| 14C              | Module enable/disable feature flag (S1)                   | 🔴    | 180  |
| 14D              | EventBus service (in-process pub/sub for modules)         | 🔴    | 180  |
| 14E              | Beta access flag system (S2)                              | 🔴    | 180  |
| 14F              | Operational kill-switch (S8 — Redis flag)                 | 🔴    | 130  |
| **Test Gate 14** | **Mock module registers, emits event, kill-switch works** | 🔴    | —    |

### Phase Group 15 — Settings & i18n

| Phase            | Title                                                   | Model | ~LOC |
| ---------------- | ------------------------------------------------------- | ----- | ---- |
| 15A              | Settings table + service (per-module, per-user, global) | 🟢    | 180  |
| 15B              | i18n service (S7) — fa-IR.json loader                   | 🟢    | 150  |
| 15C              | i18n integration in error messages, notifications       | 🟢    | 130  |
| **Test Gate 15** | **All Persian strings load via i18n, no hardcodes**     | 🟢    | —    |

### Phase Group 16 — Next.js Frontend Skeleton

| Phase            | Title                                                               | Model | ~LOC |
| ---------------- | ------------------------------------------------------------------- | ----- | ---- |
| 16A              | Next.js scaffold + Tailwind + shadcn/ui init                        | 🟢    | 150  |
| 16B              | Vazirmatn font + RTL config + theme tokens (orange + light)         | 🔴    | 180  |
| 16C              | API client (fetch wrapper + auth token handling + refresh rotation) | 🔴    | 200  |
| 16D              | Auth state (Zustand) + useAuth hook                                 | 🔴    | 180  |
| 16E              | i18n setup (S7) — `fa-IR.json` + `t()` helper                       | 🟢    | 150  |
| 16F              | shadcn/ui Persian RTL primitives audit + patches                    | 🔴    | 180  |
| **Test Gate 16** | **Frontend renders, RTL correct, theme matches brand**              | 🔴    | —    |

### Phase Group 17 — Auth UI

| Phase            | Title                                              | Model | ~LOC |
| ---------------- | -------------------------------------------------- | ----- | ---- |
| 17A              | Phone entry page (Iranian format validation)       | 🟢    | 180  |
| 17B              | OTP entry page (6-digit input, countdown, resend)  | 🔴    | 200  |
| 17C              | Profile completion page (name, national ID, email) | 🔴    | 200  |
| 17D              | TOTP enrollment page (super_admin only)            | 🔴    | 180  |
| 17E              | Logout flow + active sessions page                 | 🟢    | 180  |
| **Test Gate 17** | **Full auth flow runs end-to-end on web**          | 🔴    | —    |

### Phase Group 18 — Layout & Navigation

| Phase            | Title                                                             | Model | ~LOC |
| ---------------- | ----------------------------------------------------------------- | ----- | ---- |
| 18A              | App shell (sidebar + header + content area)                       | 🟢    | 200  |
| 18B              | Logo component + brand orange accents                             | 🟢    | 100  |
| 18C              | User menu (profile, logout, sessions)                             | 🟢    | 150  |
| 18D              | Notifications bell + dropdown (live via WS)                       | 🔴    | 200  |
| 18E              | Mobile drawer + responsive nav                                    | 🟢    | 180  |
| **Test Gate 18** | **Layout renders all roles, mobile works, WS notifications live** | 🟢    | —    |

### Phase Group 19 — Admin Shell

| Phase            | Title                                                            | Model | ~LOC |
| ---------------- | ---------------------------------------------------------------- | ----- | ---- |
| 19A              | Admin layout + sidebar with role-gated menu                      | 🟢    | 180  |
| 19B              | Users list + filters + actions                                   | 🟢    | 200  |
| 19C              | Audit log viewer                                                 | 🟢    | 180  |
| 19D              | Payout queue UI (approval workflow)                              | 🔴    | 200  |
| 19E              | Settings management UI                                           | 🟢    | 180  |
| 19F              | Module enable/disable UI (S1)                                    | 🟢    | 150  |
| 19G              | Kill-switch UI (S8)                                              | 🟢    | 100  |
| 19H              | Impersonation start UI + active impersonation banner (S3)        | 🔴    | 200  |
| **Test Gate 19** | **All admin pages role-gated, dangerous ops require S6 confirm** | 🔴    | —    |

### Phase Group 20 — Health, Logs, Observability

| Phase            | Title                                                       | Model | ~LOC |
| ---------------- | ----------------------------------------------------------- | ----- | ---- |
| 20A              | /health endpoint (DB + Redis + Meili checks)                | 🟢    | 130  |
| 20B              | Structured logging (Pino) + log file rotation               | 🟢    | 130  |
| 20C              | Error tracking adapter (GlitchTip-compatible OR file-based) | 🔴    | 150  |
| **Test Gate 20** | **Health green when up, errors captured**                   | 🟢    | —    |

### Phase Group 21 — Production Hardening

| Phase            | Title                                                       | Model | ~LOC |
| ---------------- | ----------------------------------------------------------- | ----- | ---- |
| 21A              | VPS provisioning script (Ubuntu 24.04, Docker, deploy user) | 🔴    | 180  |
| 21B              | Caddyfile + TLS + security headers                          | 🔴    | 150  |
| 21C              | docker-compose.prod.yml + .env.production template          | 🔴    | 200  |
| 21D              | Server hardening (UFW, fail2ban, unattended-upgrades)       | 🔴    | 180  |
| 21E              | Backup script (pg_dump + file snapshot + offsite)           | 🔴    | 200  |
| 21F              | Restore drill script + documentation                        | 🔴    | 150  |
| **Test Gate 21** | **Production deploy succeeds, restore drill verified**      | 🔴    | —    |

### Phase Group 22 — Release Hardening Pipeline

| Phase            | Title                                                     | Model | ~LOC |
| ---------------- | --------------------------------------------------------- | ----- | ---- |
| 22A              | release-build.sh — strip CLAUDE.md files                  | 🔴    | 130  |
| 22B              | Comment-stripping post-processor (CLAUDE: prefix + JSDoc) | 🔴    | 200  |
| 22C              | Source map disable + obfuscation in release               | 🔴    | 150  |
| 22D              | Pre-release verification script                           | 🔴    | 150  |
| **Test Gate 22** | **Release artifact contains zero CLAUDE comments**        | 🔴    | —    |

### Phase Group 23 — Quality Gates

| Phase            | Title                                                  | Model | ~LOC |
| ---------------- | ------------------------------------------------------ | ----- | ---- |
| 23A              | Manual deploy script (no CI/CD per website constraint) | 🟢    | 150  |
| 23B              | Test runners (Jest unit + Playwright E2E auth flow)    | 🔴    | 200  |
| 23C              | Contract tests (API shape never breaks v1 consumers)   | 🔴    | 200  |
| 23D              | Dependency scanner (npm audit + Trivy) script          | 🟢    | 130  |
| 23E              | OWASP ZAP baseline scan script                         | 🔴    | 130  |
| **Test Gate 23** | **All tests pass, no high-severity vulnerabilities**   | 🔴    | —    |

### Phase Group 24 — Documentation

| Phase            | Title                                               | Model | ~LOC |
| ---------------- | --------------------------------------------------- | ----- | ---- |
| 24A              | docs/architecture.md                                | 🟢    | 200  |
| 24B              | docs/module-contract.md (how to write a new module) | 🔴    | 200  |
| 24C              | docs/api-conventions.md                             | 🟢    | 180  |
| 24D              | docs/auth-flow.md                                   | 🟢    | 150  |
| 24E              | docs/security.md + threat model                     | 🔴    | 200  |
| 24F              | docs/deployment.md + docs/operations.md             | 🟢    | 200  |
| 24G              | README.md + onboarding guide                        | 🟢    | 200  |
| **Test Gate 24** | **Docs complete, new dev can onboard in 1 day**     | 🟢    | —    |

---

## Plan Aggregate

| Metric                   | Value                          |
| ------------------------ | ------------------------------ |
| Total phase groups       | 24                             |
| Total development phases | ~110                           |
| Total test gates         | 24                             |
| Total estimated LOC      | ~17,500                        |
| Estimated execution time | ~55 hours of Claude Code       |
| Estimated calendar time  | 8–10 sessions across 3–4 weeks |
| Sonnet phases            | ~70%                           |
| Opus phases              | ~30%                           |

---

## Phase Detail Examples (full prompt template)

The full plan file is too long to inline every prompt. To match the OrgPanel format, every phase follows this structure:

```
### Phase {ID}: {Title}
**Model: {🟢|🔴} {Sonnet|Opus}** | ~{N} LOC

**Why {Opus|Sonnet}:** {one-line justification}

**Deliverables:**
- {bullet 1}
- {bullet 2}
- ...

**Files created:**
- {path 1}
- {path 2}

**Claude Code prompt:**
```

Read SAZIQO_PLATFORM_SYSTEM_PLAN.md fully. Execute Phase {ID}.
{specific instructions, including where to find the contract,
which dependencies to install, and what acceptance looks like}

```

```

I will produce the full per-phase content in the saved skill version (one phase per ~6–10 lines like the website plan), but the table above is the authoritative skeleton.

---

## Test Gate Philosophy

Same as the website plan:

1. **Build integrity** — `pnpm build` succeeds on every gate
2. **Type integrity** — `pnpm typecheck` passes
3. **Test integrity** — `pnpm test` passes
4. **Phase-specific assertions** — listed per gate

**Local commands the developer runs before deploy:**

```bash
pnpm install
pnpm build              # Turborepo builds api + web
pnpm typecheck          # All packages
pnpm test               # Unit + E2E
pnpm test:contract      # API contract tests
pnpm audit              # Dependency vulnerabilities
pnpm release:build      # Strips CLAUDE.md + comments
./infra/scripts/deploy.sh
```

---

## Pre-Build Decisions Still Open

These do not block the plan but block execution start:

1. **Domain `app.saziqo.ir`** — DNS configured to platform VPS?
2. **Iranian VPS for platform** — provider, account ready, separate from website server?
3. **GitHub repo** — created, private, name `saziqo-platform`?
4. **SMS provider** — which Iranian provider? Credentials when?
5. **ZarinPal merchant** — account active, credentials when?
6. **Object storage for backups** — which Iranian provider?
7. **Initial super_admin** — phone number to seed at boot?

---

## What Modules Will Be Planned Separately

Once this skeleton is built and stable, separate plans for each module:

| Module                | Module name | Persian name         | Plan file (future)         |
| --------------------- | ----------- | -------------------- | -------------------------- |
| Agents Marketplace    | `agents`    | ایجنت‌های هوش مصنوعی | `agents-module-plan.md`    |
| Builders Marketplace  | `builders`  | بازارگاه سازندگان    | `builders-module-plan.md`  |
| Templates Marketplace | `templates` | قالب‌های آماده       | `templates-module-plan.md` |
| Tools & Docs          | `tools`     | ابزار و مستندات      | `tools-module-plan.md`     |
| DevOps Service        | `devops`    | دواپس                | `devops-module-plan.md`    |
| Security Audit        | `security`  | ممیزی امنیتی         | `security-module-plan.md`  |

Each module plan reuses the system contract — modules do not redesign auth, ledger, payments, or notifications. They consume them.

---

## What Goes Into the Skill

After your approval, I will save:

- This file → `/mnt/skills/user/ai-gold-rush-venture/references/platform-system-plan.md`
- Update `SKILL.md` to load it whenever you reference "platform", "app.saziqo.ir", "system", "skeleton", or any phase ID (e.g. `3F`, `9C`, `21B`)
- Mark the previous `platform-tech.md` as superseded by this plan + the future module plans
