# سازیکو Platform

A self-hosted, modular business platform for Iranian developers, makers, and businesses building with AI — running at `app.saziqo.ir`.

Persian RTL UI · Phone + SMS OTP auth · 100% open-source · no paid SaaS runtime dependencies

---

## Quick Start

**Prerequisites:** Node.js ≥ 20, pnpm ≥ 10, Docker + Docker Compose, GNU Make

```bash
# 1. Clone
git clone https://github.com/skarimi1006/saziqo-platform.git
cd saziqo-platform

# 2. Install dependencies
pnpm install

# 3. Configure environment (dev defaults are already filled in)
cp .env.example .env
```

The only values that need changing for local dev are the secrets that ship as obvious placeholders:

```bash
# Generate real secrets (run each line separately, paste output into .env)
openssl rand -hex 32   # → JWT_SECRET
openssl rand -hex 32   # → JWT_REFRESH_SECRET
openssl rand -hex 32   # → OTP_SALT
```

SMS and payments both default to `console` adapter in dev — no external credentials needed.

```bash
# 4. Start infrastructure (Postgres 16, Redis 7, Meilisearch)
make dev-up
# Wait ~30 seconds on first run for Postgres to initialize

# 5. Start the applications
pnpm dev
# api  →  http://localhost:3001
# web  →  http://localhost:3000
```

### Verify everything is running

```bash
# Infrastructure health
curl http://localhost:7700/health          # Meilisearch → {"status":"available"}
make redis-shell                           # redis-cli; type PING → PONG; exit

# API health
curl http://localhost:3001/api/v1/health   # → {"data":{"status":"ok",...}}

# Open the app
open http://localhost:3000                 # (or visit in browser)
```

### First login

The dev seed bootstraps a super_admin from the phone number in `SUPER_ADMIN_PHONE` (default `+989123456789`). In dev, all OTPs are hardcoded to `000000` — no SMS required.

1. Visit `http://localhost:3000/login`
2. Enter any Iranian phone number (e.g. `09123456789`)
3. Enter OTP `000000`
4. Complete the profile form (firstName/lastName/nationalId/email)

### Useful Make targets

```bash
make dev-logs    # tail all dev service logs
make dev-down    # stop services (volumes kept)
make dev-reset   # stop + destroy volumes (full reset)
make db-shell    # psql shell inside Postgres container
make redis-shell # redis-cli inside Redis container
make help        # list all targets
```

---

## Tech Stack

| Layer           | Technology                                                   |
| --------------- | ------------------------------------------------------------ |
| Backend         | NestJS (TypeScript strict, ESM)                              |
| Frontend        | Next.js 15 App Router + Tailwind CSS + shadcn/ui             |
| Database        | PostgreSQL 16 — Prisma ORM, append-only migrations           |
| Cache / Queue   | Redis 7 + BullMQ                                             |
| Search          | Meilisearch                                                  |
| Auth            | Phone + SMS OTP only; TOTP for super_admin (no passwords)    |
| Payments        | ZarinPal (abstracted behind `PaymentProvider` interface)     |
| File storage    | Local FS at `/var/saziqo-platform/files/` behind `FileStore` |
| Package manager | pnpm 10                                                      |
| Monorepo        | Turborepo (no remote cache)                                  |
| Containers      | Docker + Docker Compose                                      |
| Reverse proxy   | Caddy (TLS termination, security headers)                    |

---

## Repository Structure

```
saziqo-platform/
├── apps/
│   ├── api/                  NestJS backend
│   │   ├── src/core/         System layer (auth, RBAC, sessions, ledger, …)
│   │   ├── src/modules/      Business modules (agents, tools, builders, …)
│   │   ├── src/common/       Shared interceptors, guards, pipes, decorators
│   │   └── prisma/           Schema + append-only migrations
│   └── web/                  Next.js 15 frontend (Persian RTL)
│       └── src/app/          Route groups: (public) (auth) (account) (admin)
├── packages/
│   ├── config/               Shared tsconfig, eslint, prettier
│   ├── shared-types/         TypeScript types shared across apps
│   ├── shared-validators/    Zod schemas
│   ├── persian-utils/        Phone, national ID, Jalali calendar, numerals
│   └── ui/                   Cross-app component primitives
├── infra/
│   ├── caddy/                Caddyfile (TLS + security headers)
│   ├── docker/               Production Compose file
│   └── scripts/              deploy.sh, harden.sh, backup.sh, restore-drill.sh
├── docs/                     Developer documentation (see below)
├── plan/                     Phase-by-phase implementation plan
├── docker-compose.dev.yml    Dev infrastructure (Postgres, Redis, Meilisearch)
├── Makefile                  Dev and deploy shortcuts
└── .env.example              All environment variables with explanations
```

---

## Documentation

| Document                                           | Contents                                                     |
| -------------------------------------------------- | ------------------------------------------------------------ |
| [docs/architecture.md](docs/architecture.md)       | System diagram, component responsibilities, request pipeline |
| [docs/module-contract.md](docs/module-contract.md) | How to write a new business module end-to-end                |
| [docs/auth-flow.md](docs/auth-flow.md)             | OTP flow, JWT lifecycle, refresh rotation, super_admin TOTP  |
| [docs/deployment.md](docs/deployment.md)           | VPS provisioning, Caddy config, Docker Compose production    |
| [docs/operations.md](docs/operations.md)           | Backup, restore drill, monitoring, incident runbook          |
| [docs/security.md](docs/security.md)               | Threat model, secret rotation, audit log policy              |
| [docs/onboarding.md](docs/onboarding.md)           | Day-by-day guide for a new developer joining the project     |
| [CLAUDE.md](CLAUDE.md)                             | AI assistant instructions and project conventions            |

---

## Development Commands

```bash
pnpm dev          # start api + web in watch mode
pnpm build        # production build for all apps
pnpm test         # run all unit tests
pnpm test:e2e     # Playwright end-to-end tests
pnpm typecheck    # TypeScript type-check across all packages
pnpm lint         # ESLint across all packages
pnpm format       # Prettier formatting

# API database (run from repo root)
pnpm --filter api db:migrate-dev   # apply + generate new migration
pnpm --filter api db:studio        # open Prisma Studio at localhost:5555
pnpm --filter api db:migrate-reset # wipe + replay all migrations (dev only)
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch strategy, commit format (`type(scope): subject`), and PR checklist.

Before contributing code, read:

1. [CLAUDE.md](CLAUDE.md) — project conventions, locked tech stack, comment markers
2. [docs/architecture.md](docs/architecture.md) — understand the system before changing it
3. [docs/module-contract.md](docs/module-contract.md) — if building or editing a module

---

## License

License: TBD. All rights reserved until a license is chosen.
