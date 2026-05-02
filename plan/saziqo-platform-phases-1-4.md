# سازیکو Platform — Phase Groups 1–4 (Executable)

> This document expands Phase Groups 1–4 of the system skeleton plan into Claude-Code-ready execution form. Each phase contains: deliverables, files created, acceptance criteria, and a copy-paste prompt block.
>
> Read this file alongside `saziqo-platform-system-plan.md` (the master skeleton). When in conflict, the skeleton's locked decisions win — but this file's per-phase deliverables are authoritative for execution.

---

## Pre-execution Prerequisites

Before Claude Code runs Phase 1A, the following must be true:

1. **GitHub repo created:** `saziqo-platform`, private, empty, default branch `main`
2. **Local dev environment:**
   - Node.js 20 LTS installed
   - pnpm 9+ installed (`corepack enable && corepack prepare pnpm@latest --activate`)
   - Docker Desktop or Docker Engine running locally
   - Git configured with the maintainer's identity
3. **Editor:** VSCode or Cursor recommended; ESLint and Prettier extensions installed
4. **Domain:** `app.saziqo.ir` DNS configured (not blocking until Phase Group 21)
5. **Provider accounts** (not blocking phases 1–4):
   - Kavenegar account (for SMS in Phase Group 3 — credentials go in `.env`, plan continues with console adapter until then)
   - ZarinPal merchant (for Phase Group 10, not 1–4)

Claude Code does **not** need any external service credentials to complete Phase Groups 1–4. Everything runs locally with Docker Compose.

---

## Conventions Reference (apply to every phase)

### Code style

- TypeScript strict mode everywhere
- ESM modules; no CommonJS
- File names: `kebab-case.ts` for services, `kebab-case.controller.ts` / `.module.ts` / `.service.ts` for NestJS, `PascalCase.tsx` for React components
- Class names: PascalCase. Function names: camelCase. Constants: SCREAMING_SNAKE_CASE
- All exported types and functions have JSDoc; private functions get inline comments where logic is non-obvious
- All comments in **English**, all UI strings in **Persian**

### Comment markers (used by release-strip in Phase Group 22)

- `// CLAUDE: ...` → multi-line context for future Claude sessions, **stripped at release**
- `// REVIEW: ...` → flagged for human review, **stripped at release**
- `// TODO(scope): ...` → tracked work item, **kept** (intentional)
- `// SECURITY: ...` → security-relevant note, **kept** (intentional, helps audits)

### Persian conventions

- Numbers in user-facing UI: Persian numerals (۰–۹)
- Numbers in code, logs, DB: Latin (0–9)
- Dates: UTC ISO 8601 in DB and API; Jalali only in UI rendering layer
- Currency: integer toman (BIGINT), no decimals
- Phone format in DB and API: E.164 (`+989XXXXXXXXX`)

### Git commits

- Conventional Commits format: `type(scope): subject`
- Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`
- One commit per phase, message format: `feat(phase-1A): scaffold monorepo with pnpm and turborepo`

### Per-phase rules

- Hard ceiling ~200 LOC per phase (includes all files touched, not just new code)
- After each phase, Claude Code runs `pnpm typecheck && pnpm lint` before committing
- Phase prompt always begins with `Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md fully.`

---

# Phase Group 1 — Monorepo Foundation

## Phase 1A: Monorepo Scaffold (pnpm + Turborepo + workspaces)

**Model: 🟢 Sonnet** | ~120 LOC

**Deliverables:**

- Root `package.json` with workspaces config
- `pnpm-workspace.yaml` defining `apps/*` and `packages/*`
- `turbo.json` with pipelines: `build`, `dev`, `lint`, `typecheck`, `test`, `clean`
- `.gitignore` covering Node, IDE, build outputs, env files, Docker volumes
- `.nvmrc` pinning Node 20 LTS
- `.editorconfig` with UTF-8, LF, 2-space indent
- `README.md` skeleton with project name, one-line description, quick-start placeholder
- Initial commit on `main`

**Files created:**

```
package.json
pnpm-workspace.yaml
turbo.json
.gitignore
.nvmrc
.editorconfig
README.md
```

**Acceptance criteria:**

- `pnpm install` succeeds with empty workspaces (no apps yet)
- `pnpm turbo --version` resolves
- `git status` clean after commit

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 1A.

Initialize a new pnpm + Turborepo monorepo at the project root with:
- pnpm-workspace.yaml listing "apps/*" and "packages/*"
- turbo.json with pipelines: build (depends on ^build), dev (cache: false,
  persistent: true), lint, typecheck, test, clean
- Root package.json with name "saziqo-platform", private: true, scripts
  for build/dev/lint/typecheck/test/clean that delegate to turbo
- .nvmrc with "20"
- Standard .gitignore for Node + Docker + IDE
- .editorconfig (UTF-8, LF, 2-space)
- README.md with project name "سازیکو Platform" and a one-line
  description in English

Do NOT scaffold apps or packages yet. Confirm `pnpm install` runs.
Commit as "feat(phase-1A): scaffold monorepo with pnpm and turborepo".
```

---

## Phase 1B: Shared Packages (config, tsconfig, eslint, prettier)

**Model: 🟢 Sonnet** | ~150 LOC

**Deliverables:**

- `packages/config/` workspace containing:
  - `tsconfig.base.json` — strict mode, ES2022 target, ESM, paths config
  - `tsconfig.node.json` — extends base, adds Node types
  - `tsconfig.next.json` — extends base, adds Next.js settings
  - `eslint.config.js` — flat config, TypeScript, import order, no-unused-vars, persian-friendly identifiers allowed
  - `prettier.config.js` — single quotes, no semis controversy resolved (use semis), trailing commas, print width 100
- Root scripts wired: `pnpm lint`, `pnpm typecheck`, `pnpm format`
- Pre-commit hook via Husky + lint-staged (runs prettier + eslint on staged files)

**Files created:**

```
packages/config/package.json
packages/config/tsconfig.base.json
packages/config/tsconfig.node.json
packages/config/tsconfig.next.json
packages/config/eslint.config.js
packages/config/prettier.config.js
.husky/pre-commit
.lintstagedrc.json
```

**Acceptance criteria:**

- `pnpm lint` runs without errors on the empty workspace
- `pnpm typecheck` runs without errors
- Husky pre-commit hook installed (visible in `.git/hooks/pre-commit` symlink)

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 1B.

Create packages/config/ as a private workspace package. It exports:
- tsconfig.base.json with strict mode, ES2022, ESM, noUncheckedIndexedAccess
- tsconfig.node.json extending base + Node types
- tsconfig.next.json extending base + Next.js types
- eslint.config.js (flat config) using @typescript-eslint, import plugin,
  no-unused-vars (with _ prefix exception), no-console (warn outside tests)
- prettier.config.js: singleQuote true, semi true, trailingComma all,
  printWidth 100, useTabs false, arrowParens always

Add Husky + lint-staged at the root. lint-staged runs prettier --write
and eslint --fix on staged .ts/.tsx files. Update root package.json
scripts: lint, typecheck, format.

Confirm `pnpm lint` and `pnpm typecheck` exit zero on the empty workspace.
Commit as "feat(phase-1B): add shared config + tooling".
```

---

## Phase 1C: docker-compose.dev.yml (Postgres + Redis + Meilisearch)

**Model: 🟢 Sonnet** | ~130 LOC

**Deliverables:**

- `docker-compose.dev.yml` defining three services with named volumes and healthchecks:
  - `postgres` — PostgreSQL 16, named volume, healthcheck via `pg_isready`, port 5432, default DB `saziqo`, default user `saziqo`, password from env
  - `redis` — Redis 7-alpine, named volume, healthcheck via `redis-cli ping`, port 6379
  - `meilisearch` — official `getmeili/meilisearch:v1.10`, named volume, master key from env, port 7700
- `.env.example` at root with placeholders for: `POSTGRES_PASSWORD`, `MEILI_MASTER_KEY`, `SUPER_ADMIN_PHONE`, `SMS_PROVIDER`, `SMS_API_KEY`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `KAVENEGAR_API_KEY`, `KAVENEGAR_SENDER_LINE`, `ZARINPAL_MERCHANT_ID`, `NODE_ENV`, `PORT_API`, `PORT_WEB`
- `Makefile` with targets: `dev-up`, `dev-down`, `dev-logs`, `dev-reset`, `db-shell`, `redis-shell`
- README updated with quick-start: copy `.env.example` to `.env`, run `make dev-up`

**Files created:**

```
docker-compose.dev.yml
.env.example
Makefile
README.md (updated)
```

**Acceptance criteria:**

- `make dev-up` brings up all three services healthy within 30 seconds
- `psql -h localhost -U saziqo -d saziqo` connects (via `make db-shell`)
- `redis-cli -h localhost ping` returns `PONG`
- `curl http://localhost:7700/health` returns `{"status":"available"}`

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 1C.

Create docker-compose.dev.yml with three services: postgres (postgres:16),
redis (redis:7-alpine), meilisearch (getmeili/meilisearch:v1.10). Each
has a named volume for persistence and a proper healthcheck. Postgres
uses POSTGRES_USER=saziqo, POSTGRES_DB=saziqo, password from env.
Meilisearch uses MEILI_MASTER_KEY from env, MEILI_ENV=development.

Create .env.example with all placeholders listed in the plan, including
SUPER_ADMIN_PHONE (placeholder "+989XXXXXXXXX"), KAVENEGAR_API_KEY,
KAVENEGAR_SENDER_LINE, JWT_SECRET (note: "openssl rand -hex 32"),
JWT_REFRESH_SECRET (same), ZARINPAL_MERCHANT_ID, NODE_ENV=development.

Add Makefile with targets: dev-up (docker compose -f docker-compose.dev.yml
up -d), dev-down, dev-logs, dev-reset (down -v), db-shell, redis-shell.

Update README.md with a "Quick Start" section: clone, copy .env.example
to .env, run make dev-up, verify all three services healthy.

Verify all three services come up and pass healthchecks. Commit as
"feat(phase-1C): add docker-compose dev environment".
```

---

## Phase 1D: Root CLAUDE.md + Repo Conventions

**Model: 🟢 Sonnet** | ~120 LOC

**Deliverables:**

- Root `CLAUDE.md` — project context for future Claude Code sessions, includes:
  - Project identity (saziqo platform, Persian RTL, modular monolith)
  - Tech stack snapshot
  - Comment marker conventions (CLAUDE:, REVIEW:, TODO, SECURITY)
  - Reference to system plan and phases-1-4 file locations
  - Mandatory pre-work check (read plan first)
  - Persian/English language rules
- `apps/CLAUDE.md` — empty placeholder explaining apps/ structure, will be filled when apps scaffold
- `packages/CLAUDE.md` — explains packages/ purpose
- `docs/CLAUDE.md` — explains docs/ purpose
- `CONTRIBUTING.md` — commit conventions, branching, PR checklist

**Files created:**

```
CLAUDE.md
apps/CLAUDE.md
packages/CLAUDE.md
docs/CLAUDE.md
CONTRIBUTING.md
```

**Acceptance criteria:**

- Each `CLAUDE.md` is under 100 lines
- Root `CLAUDE.md` references the master plan file by exact name
- `CONTRIBUTING.md` defines Conventional Commits with examples

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 1D.

Create root CLAUDE.md with project identity, tech stack, comment marker
conventions, mandatory plan-reading rule, and Persian/English language
rules. Keep it under 100 lines.

Create apps/CLAUDE.md, packages/CLAUDE.md, docs/CLAUDE.md as short
placeholders explaining each directory's purpose. Each under 30 lines.

Create CONTRIBUTING.md with Conventional Commits format, branch naming
(feature/phase-XY-short-name), PR checklist (typecheck, lint, tests,
docs updated). Reference Phase Group 22 for release-strip rules.

All files in English (these are dev-facing, not user-facing). Commit as
"docs(phase-1D): add CLAUDE.md context and contributing guide".
```

---

## Test Gate 1: Foundation Verification

**Model: 🟢 Sonnet**

**Manual verification checklist:**

- [ ] `pnpm install` completes without errors
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `make dev-up` brings up all three services
- [ ] All three services pass healthchecks
- [ ] `make db-shell` connects to Postgres
- [ ] `redis-cli ping` returns PONG
- [ ] `curl http://localhost:7700/health` returns `available`
- [ ] Root CLAUDE.md is present and under 100 lines
- [ ] Husky pre-commit hook installed and runs
- [ ] All four commits present on main branch with conventional format

**Action if any fails:** Fix the issue, recommit, re-run gate. Do not advance.

---

# Phase Group 2 — NestJS API Skeleton

## Phase 2A: NestJS Scaffold + main.ts + app.module + config module

**Model: 🟢 Sonnet** | ~180 LOC

**Deliverables:**

- `apps/api/` workspace with NestJS 10:
  - `package.json` with NestJS dependencies (@nestjs/core, @nestjs/common, @nestjs/platform-express, @nestjs/config), plus reflect-metadata, rxjs
  - `tsconfig.json` extending `packages/config/tsconfig.node.json`
  - `nest-cli.json` for CLI integration
  - `src/main.ts` — bootstrap function: create app, enable global prefix `/api/v1`, listen on `PORT_API`
  - `src/app.module.ts` — root module, imports ConfigModule with global validation
  - `src/config/config.module.ts` + `src/config/config.schema.ts` — Zod-based env validation
  - `src/config/config.service.ts` — typed access to validated config
- Dev script: `pnpm --filter api dev` runs Nest in watch mode
- Empty `src/core/` directory with `.gitkeep`

**Files created:**

```
apps/api/package.json
apps/api/tsconfig.json
apps/api/nest-cli.json
apps/api/src/main.ts
apps/api/src/app.module.ts
apps/api/src/config/config.module.ts
apps/api/src/config/config.schema.ts
apps/api/src/config/config.service.ts
apps/api/src/core/.gitkeep
```

**Config schema must validate:**

- `NODE_ENV`: `development` | `production` | `test`
- `PORT_API`: number, default 3001
- `JWT_SECRET`: min 32 chars
- `JWT_REFRESH_SECRET`: min 32 chars
- `DATABASE_URL`: postgres URL string
- `REDIS_URL`: redis URL string
- `MEILI_HOST`: URL string
- `MEILI_MASTER_KEY`: min 16 chars
- `SUPER_ADMIN_PHONE`: E.164 Iranian format
- `SMS_PROVIDER`: `kavenegar` | `console` (default `console`)
- `KAVENEGAR_API_KEY`: optional string
- `KAVENEGAR_SENDER_LINE`: optional string
- `ZARINPAL_MERCHANT_ID`: optional string

**Acceptance criteria:**

- `pnpm --filter api dev` starts the API on port 3001
- Visiting `http://localhost:3001/api/v1` returns 404 (no routes yet — correct)
- Invalid env vars cause startup failure with clear error message
- `pnpm --filter api typecheck` exits 0

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 2A.

Scaffold apps/api as a NestJS 10 application. package.json depends on
@nestjs/core, @nestjs/common, @nestjs/platform-express, @nestjs/config,
reflect-metadata, rxjs. Dev dependencies include @nestjs/cli, ts-node,
typescript, @types/node, zod.

src/main.ts bootstraps with global prefix /api/v1, reads PORT_API from
config service, logs the listening URL. src/app.module.ts is the root
module importing ConfigModule (forRoot: isGlobal: true).

Build src/config/ with:
- config.schema.ts: Zod schema validating every env var listed in the
  plan (NODE_ENV, PORT_API, JWT_SECRET min 32, etc.)
- config.module.ts: dynamic module that loads .env, validates against
  schema, throws on validation failure with clear messages
- config.service.ts: typed wrapper around validated config

Use the tsconfig from packages/config. Add scripts: dev (nest start
--watch), build (nest build), start:prod (node dist/main.js).

Verify pnpm --filter api dev starts on port 3001 and pnpm --filter api
typecheck passes. Commit as "feat(phase-2A): scaffold nestjs api with
typed config".
```

---

## Phase 2B: Prisma Init + Base Schema + Migration Runner

**Model: 🔴 Opus** | ~160 LOC

**Why Opus:** Prisma schema decisions cascade into every module. Wrong choices here are expensive to undo.

**Deliverables:**

- `apps/api/prisma/schema.prisma`:
  - `generator client` with output to `node_modules/@prisma/client`
  - `datasource db` reading `DATABASE_URL`
  - `User`, `Session`, `Role`, `Permission`, `RolePermission`, `UserRole`, `AuditLog`, `Notification`, `Setting`, `LedgerEntry`, `Wallet`, `File`, `OtpAttempt` models with full column definitions
  - All models use `BigInt` IDs (`@id @default(autoincrement())`)
  - All models have `createdAt`, `updatedAt`, `deletedAt DateTime?` for soft deletes
  - All monetary columns are `BigInt` (toman)
- `apps/api/src/core/prisma/prisma.service.ts` — extends `PrismaClient`, handles connect/disconnect lifecycle
- `apps/api/src/core/prisma/prisma.module.ts` — provides PrismaService globally
- Initial migration generated: `pnpm --filter api db:migrate-dev --name init`
- `pnpm --filter api db:studio` opens Prisma Studio
- Schema includes a `read` and `write` URL split-ready (S4 plumbing) — for v1 both point to same URL

**Schema specifics:**

```prisma
// CLAUDE: This is the canonical core schema. Modules add their own
// schema files later; Prisma supports multi-file schemas via `prisma.config`.
// All tables here are owned by the system, never by a module.

model User {
  id                    BigInt    @id @default(autoincrement())
  phone                 String    @unique @db.VarChar(15)
  phoneVerifiedAt       DateTime?
  firstName             String?   @db.VarChar(80)
  lastName              String?   @db.VarChar(120)
  nationalId            String?   @unique @db.VarChar(10)
  email                 String?   @unique @db.VarChar(255)
  emailVerifiedAt       DateTime?
  profileCompletedAt    DateTime?
  status                UserStatus @default(PENDING_PROFILE)
  totpSecret            String?   @db.VarChar(64)
  totpEnabledAt         DateTime?
  betaFlags             String[]  @default([])
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  deletedAt             DateTime?

  sessions              Session[]
  userRoles             UserRole[]
  auditLogs             AuditLog[]
  notifications         Notification[]
  wallet                Wallet?

  @@index([status])
  @@index([deletedAt])
}

enum UserStatus {
  PENDING_PROFILE
  ACTIVE
  SUSPENDED
  DELETED
}

// ... (Session, Role, Permission, RolePermission, UserRole, AuditLog,
//      Notification, Setting, LedgerEntry, Wallet, File, OtpAttempt
//      similarly defined; see prompt for full instruction)
```

**Acceptance criteria:**

- `pnpm --filter api db:migrate-dev --name init` creates the initial migration successfully
- `pnpm --filter api db:studio` opens at `http://localhost:5555` showing all tables
- All models have soft-delete columns
- All FKs have indexes
- Prisma client generates without warnings

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 2B.

Install Prisma in apps/api: prisma (devDep), @prisma/client. Initialize
prisma/schema.prisma with PostgreSQL provider, DATABASE_URL from env.

Define these models with full columns, types, indexes, relations:
- User (BigInt id, phone unique VarChar(15) E.164, phoneVerifiedAt,
  firstName/lastName Persian-allowed VarChar, nationalId unique
  VarChar(10), email unique, emailVerifiedAt, profileCompletedAt,
  status enum {PENDING_PROFILE, ACTIVE, SUSPENDED, DELETED}, totpSecret
  VarChar(64), totpEnabledAt, betaFlags String[], createdAt, updatedAt,
  deletedAt)
- Session (id, userId FK, refreshTokenHash unique, userAgent, ipAddress,
  expiresAt, revokedAt, createdAt)
- Role (id, name unique, persianName, isSystem boolean, createdAt)
- Permission (id, code unique format "module:action:resource",
  description, createdAt)
- RolePermission (roleId FK, permissionId FK, composite PK)
- UserRole (userId FK, roleId FK, scope JSON nullable, composite PK)
- AuditLog (id, actorUserId nullable FK, action, resource, resourceId
  nullable, payloadHash, ipAddress, userAgent, createdAt; append-only)
- Notification (id, userId FK, channel enum {IN_APP, EMAIL, SMS}, type,
  payload JSON, readAt nullable, createdAt)
- Setting (id, scope enum {GLOBAL, USER, MODULE}, scopeId nullable,
  key, value JSON, createdAt, updatedAt; unique on scope+scopeId+key)
- LedgerEntry (id, userId nullable FK, walletId nullable FK, kind enum
  {DEBIT, CREDIT}, amount BigInt, currency default "IRT", reference,
  description, createdAt; append-only)
- Wallet (id unique, userId unique FK, balance BigInt default 0,
  createdAt, updatedAt)
- File (id, ownerUserId FK, path, originalName, mimeType, size BigInt,
  sha256 unique, createdAt, deletedAt)
- OtpAttempt (id, phone, codeHash, attempts default 0, expiresAt,
  consumedAt nullable, createdAt; index on phone+createdAt)

All ids are BigInt. All money fields are BigInt (toman). All tables
have createdAt, most have updatedAt, soft-delete-eligible tables have
deletedAt.

Create src/core/prisma/prisma.module.ts and prisma.service.ts. Register
PrismaModule globally in app.module.ts.

Run `pnpm --filter api db:migrate-dev --name init`. Verify migration
succeeds and tables exist via `make db-shell`. Add db:studio script.
Commit as "feat(phase-2B): add prisma core schema and migration".
```

---

## Phase 2C: Common — Response Interceptor + Error Filter + Zod Pipe

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Response/error shape locks the API contract for every module forever. Must be right.

**Deliverables:**

- `apps/api/src/common/interceptors/response.interceptor.ts` — wraps controller return values into `{ data, meta? }`
- `apps/api/src/common/filters/all-exceptions.filter.ts` — converts every error (HttpException, validation, unknown) into `{ error: { code, message, details? } }`
- `apps/api/src/common/pipes/zod-validation.pipe.ts` — accepts Zod schema, validates body/query/params, formats error to match error filter
- `apps/api/src/common/types/response.types.ts` — `ApiResponse<T>`, `ApiError`, `ApiMeta` shared types
- `apps/api/src/common/decorators/zod-body.decorator.ts`, `zod-query.decorator.ts` — for ergonomic per-endpoint usage
- All three (interceptor, filter, pipe) registered globally in `main.ts`
- Test endpoint `GET /api/v1/_diagnostics/echo?msg=hello` to verify response shape (delete in Phase 2F if no longer needed)

**Standard error codes to define (initial set):**

- `VALIDATION_ERROR`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `NOT_FOUND`
- `CONFLICT`
- `RATE_LIMITED`
- `IDEMPOTENCY_KEY_REUSED`
- `INTERNAL_ERROR`

**Acceptance criteria:**

- `GET /api/v1/_diagnostics/echo?msg=hello` returns `{ "data": { "echo": "hello" } }`
- Invalid query (missing `msg`) returns `{ "error": { "code": "VALIDATION_ERROR", ... } }`
- Throwing `NotFoundException` returns `{ "error": { "code": "NOT_FOUND", ... } }` with HTTP 404
- All shapes are typed end-to-end (controller, types, response)

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 2C.

Build the API contract primitives in apps/api/src/common/:

1. response.interceptor.ts: wraps every successful controller return
   value into { data: <return>, meta?: <pagination etc> }. Detects if
   the controller already returned { data, meta } shape and passes
   through unchanged.

2. all-exceptions.filter.ts: catches every exception. Maps:
   - HttpException → { error: { code, message } } using mapHttpToCode()
   - ZodError → VALIDATION_ERROR with field-level details
   - PrismaClientKnownRequestError → CONFLICT for P2002, NOT_FOUND
     for P2025, etc.
   - Anything else → INTERNAL_ERROR with sanitized message in production

3. zod-validation.pipe.ts: takes a Zod schema, validates input, throws
   the ZodError up so the filter can format it consistently.

4. types/response.types.ts: ApiResponse<T>, ApiError, ApiMeta. Export
   error code enum.

5. decorators/zod-body.decorator.ts and zod-query.decorator.ts: combine
   @Body() and the Zod pipe into a single decorator for ergonomics.

Register interceptor and filter globally in main.ts via app.useGlobalX.

Add a temporary diagnostics module with GET /api/v1/_diagnostics/echo
that takes ?msg= and echoes it. Use it to verify the response shape
manually, then mark it for removal in Phase 2F.

Commit as "feat(phase-2C): add api contract primitives".
```

---

## Phase 2D: Common — Middleware Chain (RequestID, Logger, Security, CORS)

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Middleware order and CORS rules are security-critical. Wrong order = security holes.

**Deliverables:**

- `apps/api/src/common/middleware/request-id.middleware.ts` — adds `X-Request-Id` header (uuid v4), propagates to logger context
- `apps/api/src/common/middleware/logger.middleware.ts` — Pino-based, structured JSON logs, includes request-id, method, path, status, latency
- `apps/api/src/common/middleware/security-headers.middleware.ts` — sets HSTS (in prod only), X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy
- `apps/api/src/common/middleware/cors.config.ts` — allow-list of origins from env (`CORS_ALLOWED_ORIGINS`), credentials true, exposed headers
- All wired in `main.ts` in the correct order: RequestID → Logger → Security → CORS → (later: RateLimit, Auth, RBAC, Audit, Handler)
- Pino logger configured to write to stdout in dev, stdout + file in production

**Acceptance criteria:**

- Every response has `X-Request-Id` header
- Every request logs structured JSON with request-id, method, path, status, latencyMs
- `OPTIONS` preflight from allowed origin returns 204 with proper CORS headers
- `OPTIONS` preflight from unknown origin returns no Allow-Origin header
- Security headers visible in response

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 2D.

Install: pino, pino-http, nestjs-pino, helmet, uuid.

Build apps/api/src/common/middleware/:

1. request-id.middleware.ts: NestJS middleware that reads X-Request-Id
   from incoming request, or generates uuid v4 if absent. Stores it on
   request.requestId and on response header.

2. logger.middleware.ts: integrates nestjs-pino. Each request logged
   with: requestId, method, url, status, latencyMs, userAgent. JSON
   format. In production, write to stdout (Docker captures it).

3. security-headers.middleware.ts: uses helmet with safe defaults plus:
   - HSTS only when NODE_ENV=production (max-age=31536000, preload,
     includeSubDomains)
   - X-Frame-Options: DENY
   - Permissions-Policy: camera=(), microphone=(), geolocation=()
   - X-Content-Type-Options: nosniff
   - Referrer-Policy: strict-origin-when-cross-origin

4. cors.config.ts: exports a CORS options object that reads
   CORS_ALLOWED_ORIGINS from env (comma-separated), credentials true,
   exposes X-Request-Id and Idempotency-Key in allowed headers.

Wire in main.ts in this exact order:
  app.use(requestIdMiddleware)
  app.use(loggerMiddleware)  // via app.useLogger(pinoLogger)
  app.use(securityHeadersMiddleware)
  app.enableCors(corsConfig)

Verify with curl: response includes X-Request-Id, logs are JSON.
Add CORS_ALLOWED_ORIGINS=http://localhost:3000 to .env.example.
Commit as "feat(phase-2D): add core middleware chain".
```

---

## Phase 2E: Common — Rate-Limit Middleware (Redis-backed, S5 profile decorator)

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Rate limiting is the first line of defense against abuse. Wrong implementation is worse than none.

**Deliverables:**

- `apps/api/src/core/redis/redis.module.ts` + `redis.service.ts` — ioredis-based singleton, lazy connection, connection retry
- `apps/api/src/common/middleware/rate-limit.middleware.ts` — sliding-window rate limiter using Redis sorted sets
- `apps/api/src/common/decorators/rate-limit.decorator.ts` — `@RateLimit({ user: '5/min', ip: '10/min' })` per-endpoint override
- Default profile (applied when no decorator): `100/min/user, 30/min/ip`
- Headers exposed: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`
- 429 response uses error filter format: `{ error: { code: "RATE_LIMITED", ... } }`

**Implementation notes:**

- Key format: `ratelimit:{scope}:{identifier}:{windowMinute}` (scope = user|ip, identifier = userId|ip)
- Sliding window via Redis ZREMRANGEBYSCORE + ZADD + ZCOUNT atomic via Lua script or pipeline
- Bypass for super_admin role (read from request.user once auth is wired in 3J — for now, no bypass)
- Localhost in dev: rate limits still apply but with relaxed defaults

**Acceptance criteria:**

- 31st request from same IP within 60 seconds returns 429
- Headers `X-RateLimit-*` present on every response
- `Retry-After` header present on 429
- `@RateLimit({ ip: '2/min' })` decorator overrides default to 2/min
- Rate-limit state persists across API restarts (Redis-backed)

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 2E.

Install: ioredis, @nestjs/throttler (or build custom — see below).

Build apps/api/src/core/redis/:
- redis.module.ts: provides RedisService globally
- redis.service.ts: ioredis singleton, reads REDIS_URL, lazy connect,
  retry on disconnect

Build apps/api/src/common/middleware/rate-limit.middleware.ts as a
custom NestJS middleware (do not use @nestjs/throttler — we need
Redis-backed sliding window with custom profiles).

Use a Lua script to atomically: remove expired entries, add current
timestamp, count window, return count. Key format:
"ratelimit:{scope}:{id}:{window}".

Default: 100/min/user, 30/min/ip. Build @RateLimit decorator that
attaches metadata to the route handler. Middleware reads metadata
via Reflector.

On limit exceeded:
- Return HTTP 429 via the error filter (RATE_LIMITED code)
- Set Retry-After header
- Include reset time in error.details

Always set X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
headers.

Test scenario in apps/api/test/integration/rate-limit.spec.ts:
hammer the diagnostics endpoint 31 times in <60s, expect 429 on 31st.

Commit as "feat(phase-2E): add redis-backed rate limiter".
```

---

## Phase 2F: Common — Idempotency Interceptor (Redis 24h dedup)

**Model: 🔴 Opus** | ~150 LOC

**Why Opus:** Idempotency is critical for payment-affecting endpoints. A bug here causes double-charges.

**Deliverables:**

- `apps/api/src/common/interceptors/idempotency.interceptor.ts`
- `apps/api/src/common/decorators/idempotent.decorator.ts` — marks an endpoint as requiring idempotency
- Behavior:
  - When `@Idempotent()` is set, request must include `Idempotency-Key` header
  - Key + method + path stored in Redis with the response payload, TTL 24h
  - Same key+method+path within 24h returns the cached response
  - Different key on same request → fresh execution
  - Missing key on idempotent endpoint → 400 with `IDEMPOTENCY_KEY_REQUIRED` error code (add to error code enum)
  - Conflicting key (same key, different request body hash) → 409 with `IDEMPOTENCY_KEY_REUSED`
- Removes the temporary `_diagnostics/echo` route from Phase 2C

**Acceptance criteria:**

- Test endpoint `POST /api/v1/_diagnostics/idempotent-test` (temporary, removed at end of phase) marked `@Idempotent()`
- First call with `Idempotency-Key: abc` returns 200 with body
- Second call with same key + same body returns same body (cached, no re-execution — verifiable via log absence)
- Second call with same key + different body returns 409
- Call without `Idempotency-Key` returns 400

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 2F.

Build idempotency primitives:

1. apps/api/src/common/decorators/idempotent.decorator.ts:
   @Idempotent() attaches metadata to a handler.

2. apps/api/src/common/interceptors/idempotency.interceptor.ts:
   - On request, check if handler has @Idempotent metadata
   - If yes, require Idempotency-Key header (else 400 with code
     IDEMPOTENCY_KEY_REQUIRED — add to error enum)
   - Compute requestHash = sha256(method + path + sortedBodyJson)
   - Lookup Redis key "idem:{idempotencyKey}"
   - If hit: compare stored requestHash. If match, return cached response.
     If mismatch, return 409 IDEMPOTENCY_KEY_REUSED.
   - If miss: execute handler, store {requestHash, responseStatus,
     responseBody} in Redis with TTL 24h, return response.

3. Add error codes to enum: IDEMPOTENCY_KEY_REQUIRED, IDEMPOTENCY_KEY_REUSED.

Register the interceptor globally in main.ts AFTER the response
interceptor (order matters — idempotency wraps the post-execution
response).

Add a temporary route POST /api/v1/_diagnostics/idempotent-test
marked @Idempotent() that accepts {value: string} and returns
{ value, timestamp }. Manually verify with curl:
  curl -X POST -H "Idempotency-Key: k1" -d '{"value":"a"}' ...
  → {data: {value:"a", timestamp:T1}}
  curl -X POST -H "Idempotency-Key: k1" -d '{"value":"a"}' ...
  → {data: {value:"a", timestamp:T1}}  (same timestamp = cached)
  curl -X POST -H "Idempotency-Key: k1" -d '{"value":"b"}' ...
  → 409 IDEMPOTENCY_KEY_REUSED

After verification, REMOVE both diagnostics routes (echo from 2C and
idempotent-test from this phase). Commit as "feat(phase-2F): add
idempotency interceptor and remove diagnostics routes".
```

---

## Test Gate 2: API Skeleton Verification

**Model: 🔴 Opus**

**Manual + automated verification:**

- [ ] `pnpm --filter api dev` starts API without errors
- [ ] `pnpm --filter api typecheck` exits 0
- [ ] `pnpm --filter api lint` exits 0
- [ ] `GET /api/v1/health` (build a stub if not yet present) returns 200 with response shape `{ "data": { "status": "ok" } }`
- [ ] `OPTIONS /api/v1/health` from `http://localhost:3000` returns 204 with CORS headers
- [ ] `OPTIONS /api/v1/health` from `http://example.com` returns no Allow-Origin
- [ ] Every response has `X-Request-Id` header
- [ ] Every response has `X-RateLimit-*` headers
- [ ] Logs are structured JSON with request-id correlation
- [ ] Force a validation error → response shape `{ "error": { "code": "VALIDATION_ERROR" } }`
- [ ] Force a 404 → response shape `{ "error": { "code": "NOT_FOUND" } }`
- [ ] Hammer 31 requests in <60s → 31st returns 429 with proper error code
- [ ] Initial Prisma migration committed; `make db-shell` shows all tables
- [ ] Helmet security headers visible in response

**Action if any fails:** Fix, recommit, re-run gate. Do not advance.

---

# Phase Group 3 — Auth & Sessions

## Phase 3A: Users Repository + Service Foundations

**Model: 🟢 Sonnet** | ~150 LOC

**Deliverables:**

- `apps/api/src/core/users/users.module.ts`
- `apps/api/src/core/users/users.service.ts` — methods: `findByPhone`, `findById`, `create`, `update`, `markPhoneVerified`, `completeProfile`, `softDelete`
- `apps/api/src/core/users/users.repository.ts` — Prisma access, with `read()` and `write()` methods on top of PrismaService (S4 read-replica plumbing — both methods point to same client in v1, but the abstraction exists)
- `apps/api/src/core/users/dto/` — Zod schemas: `CompleteProfileDto`, `UpdateUserDto`
- Unit tests for the service (mock repository)

**Acceptance criteria:**

- `findByPhone('+989000000000')` returns null for non-existent
- `create({ phone })` creates a user with status `PENDING_PROFILE`
- `completeProfile(userId, dto)` updates fields and sets status `ACTIVE` + `profileCompletedAt`
- All Prisma calls go through `repository.read()` or `repository.write()`
- Unit tests pass

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 3A.

Create apps/api/src/core/users/:
- users.module.ts: imports PrismaModule, exports UsersService
- users.repository.ts: wraps PrismaService with read() and write()
  methods. In v1 both return the same client. CLAUDE: this is the S4
  read-replica plumbing — when we add a replica, change read() to
  return a different client.
- users.service.ts: methods listed in the plan, all delegating to
  repository
- dto/complete-profile.dto.ts: Zod schema validating firstName/lastName
  Persian only via regex /^[\u0600-\u06FF\s]+$/, nationalId via the
  Iranian checksum (placeholder — full checksum impl in Phase 3D),
  email via z.string().email()
- dto/update-user.dto.ts: partial UpdateUserDto for admin patches

Add unit tests in apps/api/src/core/users/users.service.spec.ts using
NestJS testing module + jest mocks. Cover happy path + edge cases.

Verify tests pass with `pnpm --filter api test`. Commit as "feat(phase-3A):
add users module foundations".
```

---

## Phase 3B: Sessions Service + Token Issuance

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** Sessions and token rotation are security-critical. Bugs here = account takeover.

**Deliverables:**

- `apps/api/src/core/sessions/sessions.module.ts`
- `apps/api/src/core/sessions/sessions.service.ts`:
  - `issueTokens(userId, userAgent, ipAddress)` → returns `{ accessToken, refreshToken, refreshTokenCookie }`
  - `rotateRefreshToken(currentRefreshToken)` → returns new pair, revokes old
  - `revokeSession(sessionId)`, `revokeAllForUser(userId)`
  - `findActive(userId)` → list of active sessions for the active-sessions UI
- Access JWT: 15-minute expiry, payload `{ sub: userId, type: 'access', iat, exp, jti }`, signed with `JWT_SECRET` using jose (HS256)
- Refresh token: 64-byte random, hashed with sha256 stored in DB, 30-day expiry
- Refresh-token rotation: every refresh issues a new pair, old token marked `revokedAt`
- Cookie config: `HttpOnly; Secure (in prod); SameSite=Strict; Path=/api/v1/auth/refresh`

**Acceptance criteria:**

- `issueTokens` writes a row to `Session` with `refreshTokenHash` (raw token never stored)
- Refresh flow: old session marked revoked, new session created
- Reusing a revoked refresh token throws `UNAUTHORIZED` and revokes ALL sessions for that user (token-replay protection)
- Access tokens validate via `jose.jwtVerify`

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 3B.

Install: jose, ms.

Create apps/api/src/core/sessions/:
- sessions.module.ts
- sessions.service.ts with the methods listed in the plan

Token rules:
- Access JWT: HS256, secret from JWT_SECRET, 15-minute expiry, payload
  { sub: string(userId), type: 'access', jti: uuid }
- Refresh token: crypto.randomBytes(64).toString('base64url'). Store
  sha256 hex hash in DB. Original returned to client only on issue/rotate.
- Cookie: HttpOnly + Secure (when NODE_ENV=production) + SameSite=Strict
  + Path=/api/v1/auth/refresh + maxAge 30 days

Token rotation logic:
- On refresh: look up session by refreshTokenHash. If found and not
  revoked and not expired → mark old session revoked (revokedAt = now),
  create new session, return new pair.
- If found but revoked → SECURITY: this is replay. Revoke ALL active
  sessions for that user. Return UNAUTHORIZED with code SESSION_REPLAY.
- If not found → return UNAUTHORIZED with code SESSION_INVALID.

Add error codes: SESSION_INVALID, SESSION_REPLAY, SESSION_EXPIRED.

Unit tests in sessions.service.spec.ts cover all four flows.

Commit as "feat(phase-3B): add sessions service with refresh rotation".
```

---

## Phase 3C: Phone + National ID Validators

**Model: 🟢 Sonnet** | ~120 LOC

**Deliverables:**

- `packages/persian-utils/` — new shared workspace package
- `packages/persian-utils/src/phone.ts`:
  - `normalizeIranianPhone(input: string): string` → returns E.164 `+989XXXXXXXXX` or throws
  - `isValidIranianPhone(input: string): boolean`
- `packages/persian-utils/src/national-id.ts`:
  - `isValidIranianNationalId(input: string): boolean` — implements the canonical Iranian کد ملی checksum
- Unit tests in `packages/persian-utils/src/__tests__/`
- Wire into `apps/api`'s users DTO validation

**Iranian checksum algorithm (for reference):**

```
const id = '0123456789'  // 10 digits
const check = id[9]
const sum = Σ id[i] * (10 - i) for i in 0..8
const mod = sum % 11
const expected = mod < 2 ? mod : 11 - mod
isValid = check === expected
```

Plus reject obvious invalids (all same digit, less than 10 chars, non-numeric).

**Acceptance criteria:**

- `normalizeIranianPhone('09123456789')` → `+989123456789`
- `normalizeIranianPhone('+989123456789')` → `+989123456789`
- `normalizeIranianPhone('123')` throws
- `isValidIranianNationalId('0067749828')` → true (real example)
- `isValidIranianNationalId('1111111111')` → false (all same)
- All unit tests pass

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 3C.

Create packages/persian-utils/ as a workspace package:
- package.json: name "@saziqo/persian-utils", main dist/index.js,
  types dist/index.d.ts, build script via tsc
- tsconfig.json extending packages/config/tsconfig.base.json
- src/phone.ts: implement normalizeIranianPhone and isValidIranianPhone
  per the regex in the plan. Accept input formats: 09XXXXXXXXX,
  +989XXXXXXXXX, 989XXXXXXXXX. Always normalize to +989XXXXXXXXX.
  Throw with clear message on invalid input.
- src/national-id.ts: implement isValidIranianNationalId using the
  canonical algorithm (see plan). Reject all-same-digit IDs explicitly.
- src/index.ts: re-export everything

Add unit tests in src/__tests__/phone.spec.ts and national-id.spec.ts.

Wire @saziqo/persian-utils into apps/api as a workspace dependency.
Update apps/api/src/core/users/dto/complete-profile.dto.ts to use
isValidIranianNationalId in the Zod refinement, replacing the
placeholder.

Commit as "feat(phase-3C): add persian-utils package with phone and
national-id validators".
```

---

## Phase 3D: OTP Service (generate, hash, store, verify)

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** OTP is the auth credential. Implementation flaws are catastrophic.

**Deliverables:**

- `apps/api/src/core/otp/otp.module.ts`
- `apps/api/src/core/otp/otp.service.ts`:
  - `generateAndStore(phone)` → generates 6-digit code, hashes with sha256+salt, stores in `OtpAttempt` table + Redis (Redis is fast path, DB is audit), returns nothing (caller dispatches via SMS service)
  - `verify(phone, submittedCode)` → constant-time compare, returns `{ valid: boolean, userExists: boolean }`
  - `consume(phone, code)` → marks the OTP `consumedAt` so it cannot be replayed
- Rate limits enforced inside the service (defense in depth, in addition to API rate-limit middleware):
  - 1 OTP request per 60 seconds per phone (Redis lock)
  - Max 5 verification attempts per OTP (counter on `OtpAttempt.attempts`)
  - Max 5 OTP requests per 24h per phone
- Constant-time comparison via `crypto.timingSafeEqual`
- OTP expiry: 2 minutes after generation

**Acceptance criteria:**

- Two `generateAndStore` calls within 60s → second throws `OTP_RATE_LIMITED`
- Six failed `verify` attempts → `OTP_TOO_MANY_ATTEMPTS`, current OTP invalidated
- Successful `verify` returns `{ valid: true, userExists: <boolean from User table lookup> }`
- After successful `consume`, second `verify` with same code returns `{ valid: false }`

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 3D.

Build apps/api/src/core/otp/:
- otp.module.ts: imports PrismaModule, RedisModule
- otp.service.ts: implements the methods listed in the plan

Implementation:
- Generate 6 digits via crypto.randomInt(100000, 999999)
- Hash with sha256(code + phone + APP_SALT). APP_SALT comes from env.
- Add to .env.example: OTP_SALT (note "openssl rand -hex 32")
- Store in OtpAttempt row {phone, codeHash, expiresAt now+2min,
  attempts: 0}
- Also write Redis key "otp:{phone}" with the codeHash, TTL 120s
- Rate limit: BEFORE generate, check Redis "otp:lock:{phone}". If
  exists, throw OTP_RATE_LIMITED with retry-after seconds. Set lock
  with 60s TTL.
- Verify path:
  - Read from Redis "otp:{phone}". If missing, look in OtpAttempt
    (Redis evicted but DB still has it). If still missing, return
    {valid: false, reason: 'OTP_NOT_FOUND'}.
  - Increment OtpAttempt.attempts. If >5, throw OTP_TOO_MANY_ATTEMPTS,
    delete Redis key.
  - Compare via crypto.timingSafeEqual. If mismatch, return
    {valid: false}.
  - If match, return {valid: true, userExists: <usersService.findByPhone>}.
- consume(phone, code): set OtpAttempt.consumedAt = now, delete Redis
  key. Idempotent.

Add error codes: OTP_RATE_LIMITED, OTP_TOO_MANY_ATTEMPTS, OTP_NOT_FOUND,
OTP_EXPIRED, OTP_INVALID.

Unit tests cover all paths including timing attacks (verify constant-time
via timing test with deliberate-mismatch vs correct).

Commit as "feat(phase-3D): add otp service with rate limits".
```

---

## Phase 3E: SMS Provider Abstraction + Kavenegar Adapter + Console Adapter

**Model: 🟢 Sonnet** | ~150 LOC

**Deliverables:**

- `apps/api/src/core/sms/sms.module.ts`
- `apps/api/src/core/sms/sms.service.ts` — public API: `sendOtp(phone, code)`, `send(phone, message)`
- `apps/api/src/core/sms/providers/sms-provider.interface.ts`:
  ```typescript
  export interface SmsProvider {
    name: string;
    send(phone: string, message: string): Promise<{ messageId: string }>;
  }
  ```
- `apps/api/src/core/sms/providers/console.provider.ts` — writes OTP to logger, fakes message ID, useful for dev and tests
- `apps/api/src/core/sms/providers/kavenegar.provider.ts` — calls Kavenegar's `sms/send.json` endpoint (form-encoded), uses `KAVENEGAR_API_KEY` and `KAVENEGAR_SENDER_LINE`, retries once on 5xx
- Provider selection by `SMS_PROVIDER` env var (`console` or `kavenegar`); `console` is default in development
- All errors normalized: `SMS_PROVIDER_ERROR` with provider response in `details`

**Acceptance criteria:**

- With `SMS_PROVIDER=console`, calling `sendOtp('+989123456789', '123456')` writes `[SMS console] +989123456789 → 123456` to logs and returns
- With `SMS_PROVIDER=kavenegar` and a fake API key, the provider attempts the HTTP call (verify via mocked fetch in test); failure surfaces as `SMS_PROVIDER_ERROR`
- Kavenegar's response shape parsed correctly (their API returns `{ return: { status, message }, entries: [...] }`)
- Switching providers does not require any code change in callers

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 3E.

Build apps/api/src/core/sms/:
- providers/sms-provider.interface.ts: SmsProvider interface
- providers/console.provider.ts: logs to nestjs-pino at info level,
  fakes a messageId
- providers/kavenegar.provider.ts: calls
  https://api.kavenegar.com/v1/{API_KEY}/sms/send.json with form-encoded
  body { receptor, sender, message }. Parse response. Retry once on
  HTTP 5xx with 500ms delay. Throw SMS_PROVIDER_ERROR with details on
  failure.
- sms.module.ts: provides SmsService, picks provider based on
  SMS_PROVIDER env var
- sms.service.ts: sendOtp(phone, code) → constructs Persian message
  "کد تایید سازیکو: {code}\n این کد تا ۲ دقیقه معتبر است." and calls
  the active provider

CLAUDE: When credentials arrive, switch SMS_PROVIDER from "console" to
"kavenegar" in production .env. No code change required.

Add error code: SMS_PROVIDER_ERROR.

Unit tests: console.provider.spec.ts (logs and returns), kavenegar.
provider.spec.ts (mock fetch, verify request shape, response parsing,
retry behavior).

Commit as "feat(phase-3E): add sms abstraction with kavenegar adapter".
```

---

## Phase 3F: Auth Controller — POST /auth/otp/request

**Model: 🔴 Opus** | ~180 LOC

**Deliverables:**

- `apps/api/src/core/auth/auth.module.ts`
- `apps/api/src/core/auth/auth.controller.ts`
- `apps/api/src/core/auth/auth.service.ts`
- Endpoint: `POST /api/v1/auth/otp/request`
  - Body: `{ phone: string }`
  - Validation: Iranian phone format
  - Behavior: normalize phone → call OtpService.generateAndStore → call SmsService.sendOtp
  - Response: `{ data: { sent: true, expiresInSeconds: 120 } }`
  - Errors: `OTP_RATE_LIMITED`, `SMS_PROVIDER_ERROR`
  - Aggressive rate limit decorator: `@RateLimit({ ip: '10/min' })` (in addition to OTP service's per-phone limit)

**Acceptance criteria:**

- Valid request returns 200 with shape `{ data: { sent: true, expiresInSeconds: 120 } }`
- Invalid phone format returns 400 `VALIDATION_ERROR`
- Two requests to same phone within 60s → 429 with `OTP_RATE_LIMITED`
- 11 requests from same IP in 60s → 429 with `RATE_LIMITED` (different code, different layer)
- SMS console adapter logs the OTP

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 3F.

Create apps/api/src/core/auth/:
- auth.module.ts: imports OtpModule, SmsModule, UsersModule
- auth.service.ts: requestOtp(rawPhone) method
- auth.controller.ts: @Controller('auth/otp') with @Post('request')

Flow:
1. Normalize phone via @saziqo/persian-utils
2. Call OtpService.generateAndStore(phone) — this enforces per-phone rate
3. Call SmsService.sendOtp(phone, code) — but DON'T pass code; OtpService
   should return the plain code only here for SMS dispatch (one-time
   trust). CLAUDE: rethink — better: OtpService.generateAndStore returns
   {code} that is used IMMEDIATELY for SMS, then discarded. Code never
   logged.
4. Return { sent: true, expiresInSeconds: 120 }

Apply @RateLimit({ ip: '10/min' }) decorator on the controller method
in addition to OTP service's per-phone limit.

Add Zod DTO: requestOtpSchema = z.object({ phone: z.string().refine(
isValidIranianPhone, "phone_invalid") }).

Integration test: hits the endpoint, asserts 200, asserts log contains
the OTP (console adapter mode), asserts 60s rate-limit on second call.

Commit as "feat(phase-3F): add auth otp request endpoint".
```

---

## Phase 3G: Auth Controller — POST /auth/otp/verify (login + signup branch)

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** This endpoint creates user accounts and issues tokens. Single most security-critical surface.

**Deliverables:**

- Endpoint: `POST /api/v1/auth/otp/verify`
- Body: `{ phone: string, code: string }`
- Behavior:
  - Normalize phone
  - Call `OtpService.verify(phone, code)`
  - On success:
    - Look up user by phone
    - If user exists and `status = ACTIVE` → issue tokens, return `{ data: { user, accessToken, profileComplete: true } }`, set refresh cookie
    - If user exists and `status = PENDING_PROFILE` → issue tokens, return same shape with `profileComplete: false`
    - If user does NOT exist → create user with `status = PENDING_PROFILE`, `phoneVerifiedAt = now`, issue tokens, return shape with `profileComplete: false`
    - In all success cases, call `OtpService.consume`
  - On failure → propagate OTP error code
- TOTP enforcement for super_admin: defer to phase 3K (TOTP enrollment)
- Audit log entry: `LOGIN_SUCCESS` or `SIGNUP_SUCCESS` (audit module not yet built — use a placeholder logger call now, replace with audit service in phase group 6)
- Response includes user object: `{ id, phone, firstName, lastName, status, profileCompletedAt }` — exclude sensitive fields

**Acceptance criteria:**

- Existing user + valid OTP → 200 with `profileComplete: true`, refresh cookie set
- New phone + valid OTP → 200 with new user created, `profileComplete: false`
- Invalid OTP → 401 `OTP_INVALID`
- Expired OTP → 401 `OTP_EXPIRED`
- Already-consumed OTP → 401 `OTP_INVALID` (replay protection)
- Logger emits `LOGIN_SUCCESS` or `SIGNUP_SUCCESS` event with phone (placeholder until audit module)

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 3G.

Add to AuthService:
- verifyOtp(rawPhone, code, userAgent, ipAddress) method

Flow:
1. Normalize phone
2. otp = await OtpService.verify(phone, code)
3. If !otp.valid → throw mapped error (OTP_INVALID/OTP_EXPIRED)
4. user = await UsersService.findByPhone(phone)
5. If !user: user = await UsersService.create({ phone, phoneVerifiedAt: now,
   status: PENDING_PROFILE })
6. Else if !user.phoneVerifiedAt: await UsersService.markPhoneVerified(user.id)
7. tokens = await SessionsService.issueTokens(user.id, userAgent, ipAddress)
8. await OtpService.consume(phone, code)
9. logger.info({event: user.justCreated ? 'SIGNUP_SUCCESS' : 'LOGIN_SUCCESS',
   userId: user.id, phone})
10. return { user: sanitizeUser(user), accessToken: tokens.accessToken,
    profileComplete: user.status === 'ACTIVE' }; set refresh cookie

Helper sanitizeUser(user): omit totpSecret, deletedAt, betaFlags.

Add @Post('verify') controller method. @Idempotent() to allow retries
on network glitch (idempotencyKey from client). Same @RateLimit as
3F's request endpoint.

Add error codes: PROFILE_INCOMPLETE (used later for gate, not this
endpoint).

Integration test: full flow — request OTP, read OTP from console log
(via test helper), verify, check returned shape, check refresh cookie
header.

Commit as "feat(phase-3G): add auth otp verify endpoint".
```

---

## Phase 3H: Refresh Token Endpoint + JWT Auth Guard

**Model: 🔴 Opus** | ~200 LOC

**Deliverables:**

- Endpoint: `POST /api/v1/auth/refresh`
  - Reads refresh token from `Cookie` header
  - Calls `SessionsService.rotateRefreshToken`
  - Returns new access token, sets new refresh cookie
- Endpoint: `POST /api/v1/auth/logout`
  - Reads refresh token from cookie
  - Revokes session
  - Clears cookie
- `apps/api/src/common/guards/jwt-auth.guard.ts` — verifies `Authorization: Bearer ...`, attaches `request.user = { id, ... }`
- `apps/api/src/common/decorators/current-user.decorator.ts` — `@CurrentUser()` extracts user from request
- `apps/api/src/common/decorators/public.decorator.ts` — `@Public()` marks endpoints as not requiring auth
- Default: every endpoint requires JWT unless marked `@Public()`. Auth and health endpoints get `@Public()`.

**Acceptance criteria:**

- Valid access token + protected endpoint → 200
- Missing token + protected endpoint → 401 `UNAUTHORIZED`
- Expired access token + protected endpoint → 401 `TOKEN_EXPIRED` (specific code)
- `POST /auth/refresh` with valid refresh cookie → returns new access token, new cookie
- `POST /auth/logout` with valid refresh cookie → returns 200, cookie cleared, session revoked
- Replayed refresh token → 401 `SESSION_REPLAY`, all sessions for user revoked

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 3H.

Add to auth controller:
- @Post('refresh') @Public(): reads refresh cookie, calls
  SessionsService.rotateRefreshToken, sets new cookie, returns
  { accessToken }
- @Post('logout'): reads refresh cookie, revokes session, clears cookie,
  returns { success: true }

Build apps/api/src/common/guards/jwt-auth.guard.ts:
- Reads Authorization header, extracts Bearer token
- jose.jwtVerify with JWT_SECRET
- On success, attaches { id: BigInt(sub), jti } to request.user
- On expired (jwt 'exp' check) → throw with code TOKEN_EXPIRED
- On invalid signature → UNAUTHORIZED
- Honors @Public() metadata via Reflector

Build common/decorators/:
- public.decorator.ts: SetMetadata('isPublic', true)
- current-user.decorator.ts: createParamDecorator returning request.user

Register JwtAuthGuard globally in main.ts via app.useGlobalGuards.

Add error codes: TOKEN_EXPIRED, TOKEN_INVALID.

Integration tests:
- Hit a protected endpoint without token → 401
- Hit with valid token → 200
- Hit refresh with valid cookie → new access token + new cookie
- Hit refresh with revoked token → 401 SESSION_REPLAY, all sessions
  for that user revoked (verify in DB)

Commit as "feat(phase-3H): add refresh, logout, and global jwt guard".
```

---

## Phase 3I: Profile Completion Endpoint + Profile-Gate Middleware

**Model: 🔴 Opus** | ~200 LOC

**Deliverables:**

- Endpoint: `POST /api/v1/users/me/complete-profile`
  - Requires JWT
  - Body: `{ firstName, lastName, nationalId, email }`
  - Validates: Persian names, valid national ID checksum, valid email + DNS MX (defer DNS check to v1.5; for v1, just RFC 5322), no national ID/email duplicates
  - On success: updates user, sets `status = ACTIVE`, `profileCompletedAt = now`
  - Returns updated user
- `apps/api/src/common/guards/profile-complete.guard.ts`:
  - Runs after `JwtAuthGuard`
  - Reads user from DB (cached via Redis 5-minute TTL)
  - If `user.status !== ACTIVE` and the route is not in the allow-list (`/auth/*`, `/users/me/complete-profile`, `/users/me`, `/health`), throw 403 `PROFILE_INCOMPLETE`
- Allow-list maintained in a constants file
- Endpoint: `GET /api/v1/users/me` — returns sanitized user (works regardless of status)

**Acceptance criteria:**

- New user (after OTP verify) → access to `/users/me` → 200
- New user → access to any other endpoint → 403 `PROFILE_INCOMPLETE`
- New user → POST `/users/me/complete-profile` with valid body → 200, status now `ACTIVE`
- After completion → user can access other endpoints
- Duplicate national ID → 409 `CONFLICT`
- Invalid national ID checksum → 400 `VALIDATION_ERROR`

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 3I.

Add to UsersService:
- completeProfile(userId, dto) → updates fields, sets status=ACTIVE,
  profileCompletedAt=now. Throws CONFLICT on Prisma P2002 (unique
  violation on nationalId or email).

Add to UsersController (create if absent):
- @Get('me') returns sanitized user
- @Post('me/complete-profile') @Idempotent() validates body via Zod
  (CompleteProfileDto from phase 3A), calls service, returns updated user

Build apps/api/src/common/guards/profile-complete.guard.ts:
- Implements CanActivate
- After JwtAuthGuard, looks up user from cache or DB
- Allow-list (constants file): ['/api/v1/auth/...', '/api/v1/users/me',
  '/api/v1/users/me/complete-profile', '/api/v1/health']
- If status !== ACTIVE and not in allow-list → throw ForbiddenException
  with code PROFILE_INCOMPLETE and helpful message

Cache strategy: Redis key "user:status:{userId}" with TTL 300s,
invalidated on completeProfile and any UsersService.update call.

Register guard globally AFTER JwtAuthGuard.

Add error code: PROFILE_INCOMPLETE.

Integration tests:
- Full flow: request OTP → verify (new user) → access /users/me → 200
- Same user → access any other endpoint → 403 PROFILE_INCOMPLETE
- Same user → POST complete-profile with valid body → 200, status ACTIVE
- After: same user → access any endpoint → 200

Commit as "feat(phase-3I): add profile completion and profile-gate guard".
```

---

## Phase 3J: TOTP for super_admin (enrollment + verification)

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Super-admin is the most sensitive role. TOTP done wrong is worse than no TOTP.

**Deliverables:**

- `apps/api/src/core/totp/totp.module.ts`
- `apps/api/src/core/totp/totp.service.ts`:
  - `enrollStart(userId)` → generates secret, stores ENCRYPTED in `user.totpSecret`, returns `otpauthUrl` for QR + secret string
  - `enrollVerify(userId, code)` → verifies code, on success sets `totpEnabledAt = now`
  - `verify(userId, code)` → for ongoing logins
- Uses `otplib` (TOTP, 30-second window, ±1 window tolerance)
- TOTP secret encryption: AES-256-GCM with key from env `TOTP_ENCRYPTION_KEY`
- Auth flow modification: after OTP verify, if user has `super_admin` role and `totpEnabledAt` is null → response includes `requireTotpEnrollment: true`; if `totpEnabledAt` is set → require an additional TOTP code in the verify request before issuing tokens

**Endpoints:**

- `POST /api/v1/auth/totp/enroll/start` — JWT required, generates and stores secret, returns QR URL
- `POST /api/v1/auth/totp/enroll/verify` — JWT required, body `{ code }`, verifies and activates
- The OTP verify endpoint accepts an optional `totpCode` field; if user requires TOTP, it is mandatory

**Acceptance criteria:**

- Non-super-admin user → never sees TOTP flow
- Super-admin first login → response says `requireTotpEnrollment`
- Enroll start → returns QR URL with `otpauth://totp/saziqo:{phone}?secret=...`
- Enroll verify with correct code → 200, `totpEnabledAt` set
- Subsequent login without `totpCode` → 401 `TOTP_REQUIRED`
- Login with valid `totpCode` → tokens issued

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 3J.

Install: otplib.

Build apps/api/src/core/totp/:
- totp.module.ts
- totp.service.ts:
  - enrollStart: otplib.authenticator.generateSecret(20). Encrypt with
    AES-256-GCM using TOTP_ENCRYPTION_KEY. Store ciphertext in
    user.totpSecret. Return { otpauthUrl, manualEntryKey } where
    otpauthUrl uses otplib.authenticator.keyuri(phone, 'saziqo', secret).
  - enrollVerify: decrypt, otplib.authenticator.verify(token, secret).
    On success, set user.totpEnabledAt = now.
  - verify: same decrypt + verify pattern.

Add to .env.example: TOTP_ENCRYPTION_KEY (note "openssl rand -hex 32",
exactly 32 bytes after hex-decode).

Modify auth flow in AuthService.verifyOtp:
- After OTP verify, before issuing tokens:
  - If user has super_admin role (need to check role assignment, which
    is in phase group 4 — for now, check user role IDs against env
    var SUPER_ADMIN_USER_IDS as a transient mechanism, replaced in 4D)
  - If yes and totpEnabledAt is null → return { requireTotpEnrollment:
    true, tempToken: <short-lived enrollment-only JWT> }, do NOT issue
    full tokens
  - If yes and totpEnabledAt is set → require dto.totpCode. If absent,
    throw TOTP_REQUIRED. If present, TotpService.verify(userId,
    totpCode). On fail, TOTP_INVALID.
- Else → normal flow

Add /api/v1/auth/totp/enroll/start and /enroll/verify endpoints.
The /start endpoint accepts only a tempToken (separate guard).

Add error codes: TOTP_REQUIRED, TOTP_INVALID, TOTP_NOT_ENROLLED,
TOTP_ALREADY_ENROLLED.

CLAUDE: super_admin role check is currently env-var based. Phase 4D
will replace this with proper role lookup via UserRoles table. Marking
with TODO(phase-4D).

Integration test (mock super_admin via env): full enrollment flow,
then login flow with TOTP.

Commit as "feat(phase-3J): add totp enrollment and verification for
super_admin".
```

---

## Phase 3K: Active Sessions Endpoint + Session Revocation

**Model: 🟢 Sonnet** | ~150 LOC

**Deliverables:**

- `GET /api/v1/users/me/sessions` — lists active sessions for current user (id, userAgent, ipAddress, createdAt, lastSeenAt — add `lastSeenAt` to Session model in a new migration if not already there)
- `DELETE /api/v1/users/me/sessions/:sessionId` — revoke a specific session (cannot revoke current session via this endpoint — use logout)
- `DELETE /api/v1/users/me/sessions` — revoke all OTHER sessions (keeps current)
- Update SessionsService with `findActiveForUser(userId)`, `revokeOne(sessionId, userId)`, `revokeAllExcept(userId, currentSessionId)`
- Add migration: `Session.lastSeenAt` updated on every JWT validation (cheap — fire-and-forget update, don't block request)

**Acceptance criteria:**

- User logs in twice (two devices) → `GET /sessions` returns 2 entries
- DELETE one session → that session's refresh token can no longer rotate
- DELETE all-others → only current session remains
- Cannot delete other users' sessions

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 3K.

Add migration: Session.lastSeenAt DateTime nullable, indexed.

Update JwtAuthGuard: on successful validation, fire-and-forget
update Session.lastSeenAt = now (use sessionId from jti claim — this
requires linking jti to sessionId, so update SessionsService.issueTokens
to embed sessionId in JWT jti claim or as separate sid claim).

Add to SessionsService:
- findActiveForUser(userId): returns active (not revoked, not expired)
  sessions, ordered by lastSeenAt DESC
- revokeOne(sessionId, userId): verifies ownership, sets revokedAt
- revokeAllExcept(userId, currentSessionId): bulk revoke

Add UsersController endpoints:
- @Get('me/sessions')
- @Delete('me/sessions/:id') — checks ownership
- @Delete('me/sessions') — revoke all except current (read currentSession
  from request.user.sid)

Sanitize response: hide raw IP if user is not viewing own session
(redundant here since endpoint is /me/, but keep helper for admin use later).

Integration test: log in twice, list returns 2, delete one, list returns
1, delete-all-others returns same.

Commit as "feat(phase-3K): add active sessions endpoints".
```

---

## Test Gate 3: Auth Flow End-to-End

**Model: 🔴 Opus**

**Manual + automated verification:**

- [ ] Full happy path: `POST /auth/otp/request` → check log for OTP → `POST /auth/otp/verify` → returns access token + refresh cookie + `profileComplete: false`
- [ ] `GET /users/me` works with access token
- [ ] Other endpoints return 403 `PROFILE_INCOMPLETE`
- [ ] `POST /users/me/complete-profile` with valid body succeeds, status now `ACTIVE`
- [ ] Other endpoints now work
- [ ] `POST /auth/refresh` with valid cookie → new access token
- [ ] `POST /auth/refresh` with revoked cookie → 401 `SESSION_REPLAY`, all sessions revoked
- [ ] Two devices login → `GET /users/me/sessions` returns 2
- [ ] `DELETE /users/me/sessions/{otherId}` → that session cannot refresh
- [ ] OTP rate limit: 2nd request to same phone within 60s → 429
- [ ] OTP attempt limit: 6 wrong codes → invalidated
- [ ] Invalid Iranian phone format → 400 `VALIDATION_ERROR`
- [ ] Invalid national ID checksum → 400 `VALIDATION_ERROR`
- [ ] Duplicate national ID → 409 `CONFLICT`
- [ ] No console errors during full flow
- [ ] All sensitive fields (totpSecret, refreshTokenHash) never appear in logs or API responses (manual grep verification)

**Action if any fails:** Fix, re-test, re-run gate. Do not advance.

---

# Phase Group 4 — RBAC & Permissions

## Phase 4A: Permission Service + Permissions Catalog

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** Permission model design is hard to undo. Wrong granularity = years of refactor.

**Deliverables:**

- `apps/api/src/core/rbac/rbac.module.ts`
- `apps/api/src/core/rbac/permissions.service.ts`:
  - `userHasPermission(userId, permissionCode, scope?)` → boolean
  - `getUserPermissions(userId)` → list of all granted permissions (with scopes)
  - `grantPermissionToRole(roleId, permissionCode)` (admin only via decorator)
  - `revokePermissionFromRole(roleId, permissionCode)` (admin only)
  - `assignRoleToUser(userId, roleId, scope?)`, `removeRoleFromUser(userId, roleId)` (admin only)
- Cached in Redis: `user:permissions:{userId}` with 5-minute TTL, invalidated on any role/permission mutation
- `apps/api/src/core/rbac/permissions.catalog.ts` — single source of truth for system-level permissions:
  ```typescript
  export const CORE_PERMISSIONS = [
    { code: 'users:read:profile_self', description: '...' },
    { code: 'users:update:profile_self', description: '...' },
    { code: 'admin:read:users', description: '...' },
    { code: 'admin:update:user', description: '...' },
    { code: 'admin:read:audit_log', description: '...' },
    { code: 'admin:read:payouts', description: '...' },
    { code: 'admin:approve:payout', description: '...' },
    { code: 'admin:moderate:user', description: '...' },
    { code: 'admin:impersonate:user', description: '...' },
    { code: 'admin:manage:settings', description: '...' },
    { code: 'admin:manage:modules', description: '...' },
    { code: 'admin:trigger:kill_switch', description: '...' },
    { code: 'super:everything', description: 'super_admin only — wildcards all' },
  ];
  ```
- Migration to seed catalog on first boot (also runs on every boot, idempotent)

**Acceptance criteria:**

- `userHasPermission(superAdminId, 'anything')` → true (super:everything wildcard)
- `userHasPermission(regularUserId, 'admin:read:users')` → false
- After `grantPermissionToRole(adminRole, 'admin:read:users')` and `assignRoleToUser(user, adminRole)` → true
- Cache invalidates on role change
- Catalog seeds on every boot without duplicates

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 4A.

Build apps/api/src/core/rbac/:
- permissions.catalog.ts: exports CORE_PERMISSIONS array as listed in
  the plan
- permissions.service.ts: implements userHasPermission, getUserPermissions
  (with caching), grant/revoke methods
- rbac.module.ts

userHasPermission flow:
1. Check Redis cache "user:permissions:{userId}". If hit, evaluate.
2. If miss, query: user → userRoles → role → rolePermissions → permission.
3. If user has 'super:everything' → return true for any check.
4. Wildcard support: 'agents:*:*' matches 'agents:create:listing'. Use
   simple segment-by-segment match.
5. Scope check: if permission has 'own' scope and resource has owner_id,
   only match when resource.owner_id === userId. (Scope evaluation
   happens at the call site; service returns scope info.)
6. Cache result for 5 minutes.

Build a seed function that on every API boot:
- Upserts every CORE_PERMISSIONS entry into Permission table
- Creates default roles if absent: super_admin, admin, user, viewer
- Assigns 'super:everything' to super_admin
- Assigns appropriate admin:* permissions to admin
- Assigns 'users:read:profile_self', 'users:update:profile_self' to user
- Assigns nothing to viewer (read-only — granted per-resource later)
- Idempotent: safe to re-run

Wire seed into ModuleRef OnApplicationBootstrap.

Replace the env-var SUPER_ADMIN_USER_IDS check from phase 3J with
proper role lookup via permissions.service. Mark TODO(phase-4D)
resolved.

Unit tests for permissions.service: wildcard matching, super:everything
shortcut, cache invalidation, scope evaluation.

Commit as "feat(phase-4A): add rbac engine and core permissions catalog".
```

---

## Phase 4B: RBAC Guard + @RequirePermission Decorator

**Model: 🔴 Opus** | ~180 LOC

**Deliverables:**

- `apps/api/src/common/guards/rbac.guard.ts` — runs after JwtAuthGuard and ProfileCompleteGuard
- `apps/api/src/common/decorators/require-permission.decorator.ts`:
  - `@RequirePermission('admin:read:users')` — single permission
  - `@RequirePermission('agents:create:listing', { scope: 'own' })` — with scope
  - `@RequirePermissions(['admin:read:users', 'admin:read:audit_log'])` — must have all
  - `@RequireAnyPermission(['admin:read:users', 'admin:read:payouts'])` — must have at least one
- Guard reads metadata via Reflector, calls `permissionsService.userHasPermission`
- On fail → 403 `FORBIDDEN`

**Acceptance criteria:**

- Endpoint `@RequirePermission('admin:read:users')` blocks regular user → 403
- Same endpoint allows admin → 200
- Wildcard works (super_admin gets through any check)
- Decorator stacks correctly with `@Public()`, `@Idempotent()`, etc.

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 4B.

Build apps/api/src/common/decorators/require-permission.decorator.ts
exporting:
- RequirePermission(code, options?: {scope?: string})
- RequirePermissions([code1, code2, ...]) — all required
- RequireAnyPermission([code1, code2, ...]) — any one suffices

Each sets metadata key 'rbac:permissions' with shape
{ mode: 'all'|'any', perms: [{code, scope}] }.

Build apps/api/src/common/guards/rbac.guard.ts:
- canActivate reads metadata via Reflector
- If no metadata → allow (other guards handle public)
- Get user from request.user (set by JwtAuthGuard)
- For each required perm, call permissionsService.userHasPermission
- Mode 'all' → all must return true. Mode 'any' → at least one true.
- On fail throw ForbiddenException with code FORBIDDEN, details listing
  the missing permission codes (helpful for debug, but consider hiding
  in production)

Register RbacGuard globally AFTER JwtAuthGuard and ProfileCompleteGuard.

Update auth controller endpoints:
- /auth/otp/request, /auth/otp/verify, /auth/refresh, /auth/logout →
  @Public()
- /auth/totp/enroll/* → not @Public, requires JWT but no permission

Add a sample protected endpoint to demonstrate:
- GET /api/v1/_diagnostics/rbac-test
  @RequirePermission('admin:read:users')
  → returns { ok: true, viewer: req.user.id }

Manual test: regular user → 403, admin user → 200. Then DELETE this
diagnostic endpoint and commit as "feat(phase-4B): add rbac guard and
permission decorators".
```

---

## Phase 4C: Role Seeding + Super-Admin Bootstrap

**Model: 🟢 Sonnet** | ~150 LOC

**Deliverables:**

- Bootstrap script that runs on API startup (not a one-shot migration — runs every boot, idempotent):
  - Ensure default roles exist: `super_admin`, `admin`, `user`, `viewer`
  - Ensure CORE_PERMISSIONS are upserted (already in 4A, dedupe here)
  - Ensure role-permission assignments are correct
  - Ensure the `SUPER_ADMIN_PHONE` env value has a corresponding User record with `super_admin` role assigned
    - If user does not exist with that phone → create (`status=PENDING_PROFILE`, `phoneVerifiedAt=null`) so that on first OTP login they go through normal flow and gain super_admin role automatically
    - If user exists but missing super_admin role → add it
- Logged at boot: `[bootstrap] super_admin seeded for {phone}`

**Acceptance criteria:**

- Fresh DB → boot → tables seeded with permissions, roles, super_admin user (status=PENDING_PROFILE)
- Re-boot → no duplicate rows (idempotent)
- Changing `SUPER_ADMIN_PHONE` env to a different phone → next boot creates the new super_admin user, but does NOT remove super_admin role from the previous one (manual ops decision — you remove the old admin via admin UI later)

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 4C.

Create apps/api/src/core/bootstrap/bootstrap.service.ts implementing
OnApplicationBootstrap:
- Call permissionsService seed (already from 4A)
- Ensure roles exist: super_admin, admin, user, viewer (with persianName:
  'مدیر ارشد', 'مدیر', 'کاربر', 'بیننده'); isSystem=true
- Ensure role-permission mapping (idempotent upserts)
- Read SUPER_ADMIN_PHONE from config:
  - If absent in env → log warning and skip
  - If present → normalizeIranianPhone, then:
    - upsert user by phone with status=PENDING_PROFILE if not exists
    - ensure super_admin role assigned via UserRole (idempotent)
  - Log "[bootstrap] super_admin seeded for {phone}"
- All in a single Prisma transaction

Add the BootstrapService to AppModule's providers.

Verify with fresh DB:
- make dev-reset && make dev-up
- pnpm --filter api db:migrate-dev (re-applies migrations)
- pnpm --filter api dev (boots, runs bootstrap)
- Inspect via db-shell: User table has the SUPER_ADMIN_PHONE entry,
  UserRole links it to super_admin

Restart API → no duplicate rows, no errors.

Commit as "feat(phase-4C): add bootstrap service for role seeding and
super_admin".
```

---

## Phase 4D: @AdminOnly Decorator with X-Admin-Confirm Header (S6)

**Model: 🔴 Opus** | ~130 LOC

**Why Opus:** Last line of defense against accidental destructive operations. Wrong implementation defeats the purpose.

**Deliverables:**

- `apps/api/src/common/decorators/admin-only.decorator.ts`:
  - `@AdminOnly()` — equivalent to `@RequirePermission('super:everything')`
  - `@AdminOnly({ confirmHeader: true })` — also requires `X-Admin-Confirm: true` header on the request
- Reuses RbacGuard for permission check
- New small middleware/interceptor: when `confirmHeader: true` is set, reads `X-Admin-Confirm` header. If missing or not literal string `"true"` → 412 `PRECONDITION_REQUIRED` with code `ADMIN_CONFIRM_REQUIRED`
- Works alongside existing decorators (composes cleanly)

**Acceptance criteria:**

- `@AdminOnly({ confirmHeader: true })` endpoint → admin without header → 412 with helpful message
- Same endpoint → admin WITH `X-Admin-Confirm: true` header → 200
- Non-admin → 403 (RbacGuard rejects first)
- Decorator stack with `@Idempotent()` works

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md and SAZIQO_PLATFORM_PHASES_1_4.md
fully. Execute Phase 4D.

Build apps/api/src/common/decorators/admin-only.decorator.ts:
- AdminOnly(options?: { confirmHeader?: boolean })
- Composes: applyDecorators(RequirePermission('super:everything'),
  SetMetadata('admin:confirmHeader', !!options?.confirmHeader))

Build apps/api/src/common/guards/admin-confirm.guard.ts:
- canActivate reads metadata 'admin:confirmHeader'
- If true and request.headers['x-admin-confirm'] !== 'true' → throw
  PreconditionFailedException with code ADMIN_CONFIRM_REQUIRED
- Otherwise allow

Register AdminConfirmGuard globally AFTER RbacGuard.

Add error code: ADMIN_CONFIRM_REQUIRED (HTTP 412).

Add diagnostic endpoint to verify:
- POST /api/v1/_diagnostics/dangerous-action @AdminOnly({confirmHeader: true})
  → returns { confirmed: true }

Manual test:
- Non-admin → 403
- Admin without header → 412 ADMIN_CONFIRM_REQUIRED
- Admin with X-Admin-Confirm: true → 200

REMOVE the diagnostic endpoint. Commit as "feat(phase-4D): add admin-only
decorator with confirm header (S6)".
```

---

## Test Gate 4: RBAC End-to-End

**Model: 🔴 Opus**

**Manual + automated verification:**

- [ ] Bootstrap creates super_admin user from `SUPER_ADMIN_PHONE` env
- [ ] Super_admin user logs in via OTP → receives `requireTotpEnrollment: true`
- [ ] After TOTP enrollment, login requires `totpCode`
- [ ] All four default roles exist in DB: super_admin, admin, user, viewer
- [ ] All CORE_PERMISSIONS exist in DB
- [ ] Super_admin can access an endpoint protected by any permission
- [ ] Regular user cannot access admin endpoints → 403 `FORBIDDEN`
- [ ] Admin user (after manual role assignment via DB) can access endpoints with `admin:*` permissions
- [ ] `@AdminOnly({ confirmHeader: true })` returns 412 without header, 200 with header
- [ ] Permission cache invalidates: grant new permission → next request reflects it within cache TTL or via explicit invalidation
- [ ] No `super:everything` permission accidentally assigned to non-super-admin (check by querying RolePermission table)
- [ ] Phase 3J's TODO is resolved (no env-var SUPER_ADMIN_USER_IDS lookup remaining)

**Action if any fails:** Fix, re-test, re-run gate. Do not advance.

---

# What Comes After Phase Group 4

After Test Gate 4 passes, you have:

- A NestJS API skeleton with full middleware chain (request-id, logger, security headers, CORS, rate limit, idempotency, JWT, profile-gate, RBAC, admin-confirm)
- Complete auth: phone+OTP for everyone, TOTP for super_admin
- User accounts with profile completion gate
- Sessions with refresh-token rotation and replay protection
- RBAC engine with permission caching
- Sample super_admin bootstrapped via env var

**You can now:**

1. Build any business module on top of this foundation — the contract is ready for them
2. Continue with Phase Group 5 (Users module — admin-facing user CRUD, S3 impersonation) when expanded next
3. Pause here, deploy what you have, and start designing the first business module's plan

**What is NOT yet built (deferred to later phase groups):**

- Audit log service (still using placeholder logger)
- File storage
- Notifications (placeholders only)
- Internal ledger
- Payment integration
- Search
- Realtime
- Background jobs
- Module registry (the actual loader)
- Settings + i18n
- Frontend (Next.js)
- Admin shell
- Production deployment

**Recommended next step:** confirm the Phase Group 1–4 plan as executable, save to skill, and decide whether to expand Phase Groups 5–10 next or pause to begin actual building.

---

## Open Decisions That Block Phase Group 5+

When you choose to expand Phase Group 5 onward, these need answers:

1. **Audit log retention policy** — keep forever? 1 year? 90 days?
2. **File storage path** — `/var/saziqo-platform/files/` confirmed?
3. **Maximum upload size** — 10 MB? 100 MB?
4. **Allowed MIME types** for uploads — list?
5. **Notification template language** — Persian only confirmed (i18n pipeline ready in 15B)?
6. **Email subject/body templates** — drafted by you, or generated as placeholders?
7. **Push notification provider** — none in v1, only in-app + SMS + (later) email?

These do not block Phase Groups 1–4 execution.
