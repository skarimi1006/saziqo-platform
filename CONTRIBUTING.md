# Contributing to سازیکو Platform

## Commit convention — Conventional Commits

Every commit must follow this format:

```
type(scope): subject
```

**Types:**

| Type       | When to use                               |
| ---------- | ----------------------------------------- |
| `feat`     | New feature or phase deliverable          |
| `fix`      | Bug fix                                   |
| `chore`    | Dependency updates, config tweaks         |
| `docs`     | Documentation only                        |
| `refactor` | Code restructure without behaviour change |
| `test`     | Adding or fixing tests                    |
| `perf`     | Performance improvement                   |
| `ci`       | CI/CD pipeline changes                    |

**Scope:** phase ID (`phase-2A`), module name (`auth`, `ledger`), or package (`config`, `api`, `web`).

**Examples:**

```
feat(phase-2A): nestjs scaffold with config module
fix(auth): prevent OTP reuse after successful verify
chore(deps): bump typescript-eslint to 8.33.0
test(phase-3E): otp rate-limit integration tests
docs(phase-1D): add contributing guide
```

**Rules:**

- Subject line: imperative mood, lowercase start, no period, ≤ 72 chars
- One commit per phase; fixes within a phase are squashed before merge
- Body is optional; use it for non-obvious "why" explanations

---

## Branch naming

```
feature/phase-XY-short-name     # phase work
fix/short-description           # bug fixes outside a phase
chore/short-description         # maintenance
```

Examples:

```
feature/phase-2A-nestjs-scaffold
feature/phase-3E-otp-service
fix/redis-session-expiry
chore/bump-prisma-6
```

---

## Pull request checklist

Before opening a PR, verify locally:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm test` exits 0 (or explain why tests are deferred)
- [ ] `pnpm build` exits 0
- [ ] Relevant docs updated (if API contract changed, update `docs/api-conventions.md`)
- [ ] No new `console.log` in production paths (ESLint `no-console` enforces this)
- [ ] No hardcoded Persian strings outside the i18n layer (Phase 15+)
- [ ] No cross-module imports (modules → core/common only)
- [ ] Migrations are append-only (no edits to applied migration files)

---

## Comment markers (see CLAUDE.md for full table)

- `// CLAUDE: ...` — context for future Claude sessions; **stripped at release** (Phase Group 22)
- `// REVIEW: ...` — flagged for human review; **stripped at release**
- `// TODO(scope): ...` — tracked work item; kept in release
- `// SECURITY: ...` — security-relevant note; kept in release

**Release stripping** is automated by `infra/scripts/release-build.sh`.
See Phase Group 22 in `saziqo-platform-system-plan.md` for the full stripping pipeline.

---

## Language rules

| Context                          | Language                                          |
| -------------------------------- | ------------------------------------------------- |
| UI strings                       | Persian (فارسی) — via i18n layer, never hardcoded |
| Code identifiers, comments       | English                                           |
| CLAUDE.md files                  | English                                           |
| Git commits, PR descriptions     | English                                           |
| API error messages (dev)         | English                                           |
| API error messages (user-facing) | Persian via i18n                                  |

---

## Code style

- TypeScript strict mode everywhere; zero `any` escapes without `// REVIEW:`
- ESM only — no `require()` or `module.exports`
- File names: `kebab-case.ts` for services/utils, `kebab-case.controller.ts` / `.module.ts` for NestJS, `PascalCase.tsx` for React
- Run `pnpm format` before committing if prettier wasn't applied by the pre-commit hook
