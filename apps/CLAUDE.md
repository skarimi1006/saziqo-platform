# CLAUDE.md — apps/

Two deployable applications. Do not add a third app without explicit approval.

## apps/api/ — NestJS backend (Phase 2A)

Single deployable binary. Source layout:

- `src/core/` — system layer (auth, rbac, users, sessions, files, notifications,
  audit, ledger, payments, search, realtime, jobs, settings, events,
  module-registry, i18n, health, admin-shell)
- `src/modules/` — business modules (separate plans; not in this skeleton)
- `src/common/` — interceptors, filters, pipes, decorators, guards
- `prisma/` — schema + append-only migrations
- `test/` — e2e and integration tests

tsconfig extends `@saziqo/config/tsconfig/node.json`

## apps/web/ — Next.js 15 frontend (Phase 16A)

Persian RTL, Vazirmatn font, brand orange `#f97316`.
Route groups: `(public)`, `(auth)`, `(account)`, `(admin)`.
Auth state via Zustand; API client in `lib/`; i18n via `fa-IR.json`.

tsconfig extends `@saziqo/config/tsconfig/next.json`
