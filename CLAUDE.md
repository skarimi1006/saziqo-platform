# CLAUDE.md — سازیکو Platform

## Mandatory pre-work

Before any implementation session, read the plan files under `plan/`:

- `plan/saziqo-platform-system-plan.md` — locked decisions, architecture, module contract, all phase groups
- `plan/saziqo-platform-phases-1-4.md` — executable phase detail for groups 1–4
- `plan/saziqo-platform-phases-5-7.md` — phase detail for groups 5–7
- `plan/saziqo-platform-phases-8-10.md` — phase detail for groups 8–10
- `plan/saziqo-platform-phases-11-13.md` — phase detail for groups 11–13
- `plan/saziqo-platform-phases-14-16.md` — phase detail for groups 14–16

When in conflict, the system plan's locked decisions win.

## Project identity

- **Product:** سازیکو Platform — multi-module business platform at `app.saziqo.ir`
- **Architecture:** Modular monolith — single NestJS binary + single Next.js app
- **Language:** Persian (فارسی) UI, RTL throughout; English in code, comments, CLAUDE.md only
- **Audience:** Iranian developers, makers, businesses building with AI
- **Constraint:** 100% open-source self-hosted — no paid SaaS runtime dependencies

## Tech stack (locked — do not change without explicit approval)

| Layer           | Technology                                                           |
| --------------- | -------------------------------------------------------------------- |
| Backend         | NestJS (TypeScript strict, ESM)                                      |
| Frontend        | Next.js 15 App Router + Tailwind + shadcn/ui                         |
| Database        | PostgreSQL 16 — Prisma ORM, append-only migrations                   |
| Cache/Queue     | Redis 7 + BullMQ                                                     |
| Search          | Meilisearch                                                          |
| Auth            | Phone + SMS OTP only; TOTP for super_admin                           |
| Payments        | ZarinPal (abstracted behind PaymentProvider interface)               |
| File storage    | Local FS at `/var/saziqo-platform/files/` behind FileStore interface |
| Package manager | pnpm 10                                                              |
| Monorepo        | Turborepo (no remote cache)                                          |
| Container       | Docker + Docker Compose                                              |
| Reverse proxy   | Caddy                                                                |

## Monorepo layout

```
apps/api/      — NestJS backend (core system + module registry)
apps/web/      — Next.js frontend
packages/config/   — shared tsconfig, eslint, prettier
packages/shared-types/   — TypeScript types shared across apps
packages/shared-validators/  — Zod schemas
packages/persian-utils/  — phone, national ID, Jalali, numerals
packages/ui/   — cross-app component primitives
infra/         — Caddy, Postgres init, Docker prod compose, scripts
docs/          — architecture, API conventions, auth flow, security
```

## Comment marker conventions

| Marker                | Fate at release | Purpose                                       |
| --------------------- | --------------- | --------------------------------------------- |
| `// CLAUDE: ...`      | **Stripped**    | Multi-line context for future Claude sessions |
| `// REVIEW: ...`      | **Stripped**    | Flagged for human review                      |
| `// TODO(scope): ...` | Kept            | Tracked work item                             |
| `// SECURITY: ...`    | Kept            | Security-relevant note (helps audits)         |

Release stripping is handled by `infra/scripts/release-build.sh` (Phase Group 22).

## Persian / English rules

- All UI strings: Persian (فارسی)
- All user-facing dates in UI: Jalali calendar
- All user-facing numbers in UI: Persian numerals (۰–۹)
- All code, comments, logs, DB values: English / Latin
- Phone in DB and API: E.164 (`+989XXXXXXXXX`)
- Currency: integer toman (BIGINT) — no decimals

## Module rules (enforced by lint + tests)

1. Modules own their DB tables via prefix: `agents_listings`, `tools_subscriptions`
2. Modules communicate via event bus only — no direct service-to-service calls
3. Modules import from `core/*` and `common/*` only — never from other modules
4. Module routes mount at `/api/v1/{moduleName}/...`

## Commit format

`type(scope): subject` — one commit per phase, e.g. `feat(phase-2A): nestjs scaffold`
