# Developer Onboarding — سازیکو Platform

Welcome to the project. This guide takes you from zero to productive in five days.

**Goal:** By the end of Day 1 your dev environment is running. By the end of Day 5 you have read the core architecture, explored a business module end-to-end, run the test suite, and navigated the admin shell.

---

## Tools and Access Checklist

Before Day 1, make sure you have:

- [ ] **Node.js ≥ 20** — `node -v` to verify
- [ ] **pnpm ≥ 10** — `pnpm -v`; install with `npm install -g pnpm@latest`
- [ ] **Docker Desktop** (Mac/Windows) or Docker + Docker Compose v2 (Linux)
- [ ] **GNU Make** — ships with macOS/Linux; Windows: install via `winget install GnuWin32.Make`
- [ ] **git** — `git -v`
- [ ] **VS Code** (recommended) or any TypeScript-aware editor
- [ ] Read access to this repository
- [ ] Invited to the project communication channel (Slack / Discord — ask your onboarding contact)

---

## Day 1: Environment Setup

**Time budget: ~1.5 hours**

### 1. Read the project contract

```bash
cat CLAUDE.md
```

This file is the source of truth for coding conventions, the locked tech stack, and comment marker rules. Read it before writing a single line of code.

### 2. Clone and install

```bash
git clone https://github.com/skarimi1006/saziqo-platform.git
cd saziqo-platform
pnpm install
```

`pnpm install` downloads all workspace dependencies in one pass (Turborepo monorepo). Expect ~2 minutes on first run.

### 3. Configure the environment

```bash
cp .env.example .env
```

Open `.env` and replace the three `replace_with_...` secrets:

```bash
# Run each command, copy its output, paste into .env
openssl rand -hex 32   # → JWT_SECRET
openssl rand -hex 32   # → JWT_REFRESH_SECRET
openssl rand -hex 32   # → OTP_SALT
```

Everything else (`SMS_PROVIDER=console`, `PAYMENT_PROVIDER=console`, `EMAIL_PROVIDER=console`) stays as-is for local dev — no external accounts required.

### 4. Start infrastructure

```bash
make dev-up
```

This starts three Docker containers: Postgres 16, Redis 7, Meilisearch. On the first run Docker pulls ~500 MB of images. Subsequent starts take under 5 seconds.

Wait ~30 seconds, then verify:

```bash
docker compose -f docker-compose.dev.yml ps
# All three containers should show "healthy" or "Up"

curl http://localhost:7700/health   # Meilisearch → {"status":"available"}
make redis-shell                    # redis-cli; type PING → PONG; exit
```

### 5. Start the applications

```bash
pnpm dev
```

Turborepo starts both apps in watch mode:

- API (NestJS): `http://localhost:3001`
- Web (Next.js): `http://localhost:3000`

The API applies Prisma migrations on startup. Watch the terminal for `Application is listening on port 3001`.

Verify the API:

```bash
curl http://localhost:3001/api/v1/health
# → {"data":{"status":"ok","timestamp":"...","uptime":...}}
```

### 6. Complete the OTP flow

The platform has no passwords. All auth is phone + SMS OTP. In dev, every OTP is `000000` — no Kavenegar account needed.

1. Open `http://localhost:3000/login`
2. Enter `09123456789` (or any valid Iranian mobile number)
3. Enter OTP: `000000`
4. Fill in the profile form (firstName/lastName/nationalId/email)
   - firstName/lastName: Persian characters only (e.g., `سعید` / `کریمی`)
   - nationalId: any valid 10-digit Iranian national ID
   - email: any valid email
5. You land on `/dashboard`

The `SUPER_ADMIN_PHONE` in `.env` (default `+989123456789`) gets the `super_admin` role on first boot. Log in with that number to access the admin shell at `/admin`.

**Day 1 done.** Your environment is running and you have completed the full user registration flow.

---

## Day 2: Architecture and Core Layer

**Time budget: ~3 hours**

### 1. Read the architecture doc

```bash
# In your editor or browser
docs/architecture.md
```

Pay attention to:

- The system diagram and which component is responsible for what
- The HTTP request pipeline (guard order matters)
- The two sequence diagrams: new user sign-up, and module payment flow

### 2. Explore the core layer

```
apps/api/src/core/
```

Walk through the directories. You do not need to read every file — scan the `index.ts` or service file in each:

| Directory          | What to look for                                                              |
| ------------------ | ----------------------------------------------------------------------------- |
| `module-registry/` | `module-loader.service.ts` boot sequence; `registry.service.ts` merge methods |
| `auth/`            | `auth.controller.ts` — the OTP and session endpoints you just used            |
| `otp/`             | `otp.service.ts` — rate limiting, hashing, test backdoor                      |
| `sessions/`        | `sessions.service.ts` — `rotateRefreshToken()` transaction                    |
| `rbac/`            | `rbac.guard.ts` — how `@RequirePermission` is enforced                        |
| `audit/`           | `audit.service.ts` — how events are appended to `audit_log`                   |

### 3. Trace a request end-to-end

Pick any endpoint in `apps/api/src/core/auth/auth.controller.ts` (e.g., `POST /auth/otp/request`). Open the file and follow the call chain:

- Which guard runs first? (`RateLimitGuard`)
- What does `OtpService.requestOtp()` do in Redis vs Postgres?
- What gets written to `audit_log`?

Use VS Code's "Go to Definition" (F12) to navigate.

### 4. Read the auth flow doc

```bash
docs/auth-flow.md
```

After exploring the source, the doc will confirm what you observed. Pay particular attention to the refresh token rotation sequence and the replay-detection mechanism — these are security-critical and non-obvious.

---

## Day 3: Module Contract

**Time budget: ~3 hours**

### 1. Read the module contract doc

```bash
docs/module-contract.md
```

This doc explains the `PlatformModule` interface, boot sequence, isolation rules, and all registration methods.

### 2. Explore the example module

```
apps/api/src/modules/_example/
```

This is the canonical reference. Open each file:

| File                     | What to notice                                                          |
| ------------------------ | ----------------------------------------------------------------------- |
| `index.ts`               | How `enabled` flag works; `registerPermissions()` structure             |
| `_example.module.ts`     | NestJS `@Module()` — only core imports allowed                          |
| `_example.controller.ts` | `@RequirePermission` on every handler; `@ZodBody` validation            |
| `_example.service.ts`    | Inject core services via constructor; never touch other modules' tables |
| `dto/`                   | Zod schemas + inferred types                                            |

### 3. Trace module registration

Open `apps/api/src/modules.config.ts`. See how `_example` is listed. Then open `apps/api/src/app.module.ts` and see how `MODULES` is consumed.

Run the boot sequence mentally: `ModuleLoaderService.onApplicationBootstrap()` → `registry.register()` → `mergePermissions()` → `modules_installed` check → `onInstall()` / `onBoot()`.

### 4. Verify the module is running

```bash
# The example module ships enabled in dev (see its index.ts flag logic)
curl -H "Authorization: Bearer <your-access-token>" \
     http://localhost:3001/api/v1/example/items
# → 200 with empty array (or 401 if your JWT expired — re-login)
```

To get your access token: open browser devtools → Application → Local Storage → `accessToken`.

---

## Day 4: Tests and a Small Change

**Time budget: ~2 hours**

### 1. Run the test suite

```bash
pnpm test
# Runs all unit tests across all workspace packages

pnpm --filter api test -- --testPathPattern=otp
# Run a specific test file (OTP service unit tests)
```

### 2. Understand the test setup

API tests in `apps/api/src/` are Jest unit tests that use real Postgres via a `.env` loaded by `dotenv`. They do NOT mock the database (see `apps/api/jest.config.ts`). Infrastructure must be running (`make dev-up`).

E2E tests use Playwright:

```bash
pnpm test:e2e
# Requires both api and web to be running (pnpm dev in another terminal)
```

### 3. Make a small change

Pick one of these beginner tasks:

- **Add a field to the example module DTO:** Add an optional `description` field to `apps/api/src/modules/_example/dto/create-item.schema.ts`. Run `pnpm typecheck` to verify it compiles.
- **Add a Persian description to an existing permission:** Find any `registerPermissions()` call and add a `persianDescription`. Verify the API still starts.
- **Add a log line:** In `_example.service.ts`, add a `this.logger.debug('items listed', { userId: user.id })` call. Verify it appears in the console when you hit the endpoint.

Keep the change minimal. The goal is to get comfortable with the edit → typecheck → test loop.

```bash
pnpm typecheck   # should exit 0
pnpm lint        # should exit 0
pnpm test        # all tests should pass
```

---

## Day 5: Admin Shell and Security Model

**Time budget: ~2 hours**

### 1. Log in as super_admin

The `SUPER_ADMIN_PHONE` in `.env` (default `+989123456789`) is seeded with `super_admin` on first boot. Log in with that phone number and OTP `000000`.

Super_admin requires TOTP enrollment on first login after OTP:

- Follow the enrollment flow in the browser (a QR code is shown)
- Scan with any TOTP authenticator app (Google Authenticator, Authy)
- Enter the 6-digit code to confirm enrollment

After enrollment you arrive at `/dashboard` with access to `/admin`.

### 2. Explore the admin shell

Visit `http://localhost:3000/admin`. The sidebar shows admin pages registered by each enabled module plus core admin pages.

Key admin sections to explore:

| Route                | What it shows                                |
| -------------------- | -------------------------------------------- |
| `/admin/users`       | User list, status, roles                     |
| `/admin/users/:id`   | User detail — sessions, roles, audit history |
| `/admin/audit-log`   | Append-only log of all system events         |
| `/admin/modules`     | Registry state — enabled/disabled modules    |
| `/admin/permissions` | All permissions and their role assignments   |

### 3. Read the security doc

```bash
docs/security.md
```

Focus on:

- The threat model section (what assets we protect, what we accept as risk)
- The secret rotation procedures (you will need these in production)
- The audit log review cadence

### 4. Read the operations doc

```bash
docs/operations.md
```

Focus on the daily operations checklist and the incident response severity table. Even if you are not on-call, knowing the runbook means you can help if an incident happens.

---

## Good First Issues

Once you have completed Days 1–5, look for tasks tagged `good-first-issue` in the project tracker. Until that list is populated, suitable starting points are:

- Add a `registerNotificationTypes()` to the `_example` module with a sample notification type
- Add a second permission to the `_example` module and a corresponding endpoint
- Write a unit test for an untested branch in `otp.service.ts`
- Add a missing field validation to any existing DTO
- Improve a Persian error message in the frontend (`apps/web/src/lib/`)

**Rule:** Before starting any change, read the relevant section of `CLAUDE.md` and the relevant doc in `docs/`. The architecture docs exist to save you the time of rediscovering constraints the hard way.

---

## Reference: Environment Variables

All variables are documented in `.env.example` with comments. Key ones for day-to-day dev:

| Variable               | Default         | Purpose                                               |
| ---------------------- | --------------- | ----------------------------------------------------- |
| `NODE_ENV`             | `development`   | Controls dev shortcuts (hardcoded OTP, test backdoor) |
| `PORT_API`             | `3001`          | NestJS listen port                                    |
| `PORT_WEB`             | `3000`          | Next.js listen port                                   |
| `SUPER_ADMIN_PHONE`    | `+989123456789` | Seeded as `super_admin` on first boot                 |
| `SMS_PROVIDER`         | `console`       | `console` logs OTPs; `kavenegar` sends real SMS       |
| `PAYMENT_PROVIDER`     | `console`       | `console` simulates payments via Redis flag           |
| `EMAIL_PROVIDER`       | `console`       | `console` logs emails; SMTP deferred to v1.5          |
| `ENABLE_{NAME}_MODULE` | (not set)       | Set to `true`/`false` to toggle a business module     |

---

## Reference: Key File Paths

| File / Directory                             | Purpose                                           |
| -------------------------------------------- | ------------------------------------------------- |
| `CLAUDE.md`                                  | AI assistant instructions; read first             |
| `apps/api/src/core/module-registry/types.ts` | `PlatformModule` and `ModuleDeps` interfaces      |
| `apps/api/src/modules.config.ts`             | The only place to register modules                |
| `apps/api/src/modules/_example/`             | Canonical module reference — copy this            |
| `apps/api/prisma/schema.prisma`              | Database schema                                   |
| `apps/api/prisma/migrations/`                | Append-only migration history                     |
| `apps/web/src/app/`                          | Next.js App Router pages                          |
| `apps/web/src/lib/api/`                      | Type-safe API client used by frontend             |
| `packages/persian-utils/src/`                | Phone normalization, national ID checksum, Jalali |
| `infra/scripts/deploy.sh`                    | Production deploy (read before touching CI/CD)    |
| `.env.example`                               | All environment variables with explanations       |

---

## Getting Help

- **Project docs:** `docs/` directory — start with `architecture.md`
- **Inline context:** Comments marked `// CLAUDE:` explain non-obvious design decisions (stripped at release)
- **Questions:** Post in the project communication channel; mention the file and line number
- **Bugs:** Open an issue in the repository with steps to reproduce
