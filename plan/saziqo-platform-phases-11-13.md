# سازیکو Platform — Phase Groups 11–13 (Lean MVP, Executable)

> Read alongside `saziqo-platform-system-plan.md`, `phases-1-4.md`, `phases-5-7.md`, `phases-8-10.md`.
> Phase Groups 11–13 connect the system to plug-in modules and lay down the Next.js frontend through to the working auth UI.
> Per-phase rules and conventions identical to phases 1–10.

---

## Pre-execution Decisions Locked for Phase Groups 11–16

| #   | Decision                    | Value                                                                          |
| --- | --------------------------- | ------------------------------------------------------------------------------ |
| 1   | Module loading              | **Static `import` in `modules.config.ts`** — compile-time, type-safe           |
| 2   | Error tracking in v1        | **Pino-to-file only** — GlitchTip self-hosted deferred to v1.5                 |
| 3   | First module to plan        | Deferred — separate plan per module after system stable                        |
| 4   | Frontend domain             | `app.saziqo.ir` (confirmed in earlier sessions)                                |
| 5   | shadcn/ui component palette | Install on-demand per phase, listed in each phase's deliverables               |
| 6   | Production VPS specs        | Recommended 4 vCPU / 4 GB RAM / 80 GB SSD — confirm in Phase 14A prerequisites |
| 7   | Backup destination          | Recommended Arvan Object Storage (S3-compatible) — confirm in Phase 14E        |

---

# Phase Group 11 — Module Registry & Contract

## Phase 11A: Module Contract Types + Registry Service

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** The contract is the API every module pays the cost of forever. Wrong abstractions = pain in every module.

**Deliverables:**

- `apps/api/src/core/module-registry/types.ts` — formalize the `PlatformModule` interface from the system plan:

  ```typescript
  export interface PlatformModule {
    readonly name: string; // 'agents'
    readonly persianName: string; // 'ایجنت‌های هوش مصنوعی'
    readonly version: string; // semver
    readonly enabled: boolean; // config-time flag (S1 downgrade)

    registerNestModule(): Type<unknown>; // returns the module's NestJS Module class
    registerPermissions(): PermissionDefinition[];
    registerAuditActions(): Record<string, string>;
    registerNotificationTypes?(): NotificationTypeDefinition[];
    registerAdminPages?(): AdminPageDefinition[];
    registerPaymentPurposes?(): string[]; // module-specific purposes added to allow-list

    onInstall?(deps: ModuleDeps): Promise<void>; // first-time install
    onBoot?(deps: ModuleDeps): Promise<void>; // every boot
    onShutdown?(deps: ModuleDeps): Promise<void>;
  }

  export interface PermissionDefinition {
    code: string; // 'agents:create:listing'
    description: string;
    persianDescription: string;
    defaultRoles?: string[]; // ['user', 'admin']
  }

  export interface NotificationTypeDefinition {
    type: string;
    inApp?: { titleFa: string; bodyFa: (vars: Record<string, unknown>) => string };
    sms?: (vars: Record<string, unknown>) => string;
    email?: { subject: string; textBody: (vars: Record<string, unknown>) => string };
  }

  export interface AdminPageDefinition {
    path: string; // '/admin/agents/listings'
    titleFa: string;
    icon?: string;
    permission: string; // 'agents:moderate:listing'
    order?: number;
  }

  export interface ModuleDeps {
    prisma: PrismaClient;
    redis: RedisClient;
    fileStore: FileStore;
    ledger: LedgerService;
    payments: PaymentService;
    notifications: NotificationService;
    audit: AuditService;
    config: ConfigService;
    logger: Logger;
  }
  ```

- `apps/api/src/core/module-registry/module-registry.service.ts`:
  - `register(module: PlatformModule)` — called explicitly by the loader at boot
  - `getRegistered()` → list of registered modules
  - `getByName(name)` → single module
  - `getEnabledModules()` → filtered by `enabled === true`
  - `mergePermissions()` → merges all module permissions into core catalog at boot
  - `mergeNotificationTypes()` → merges into notification template registry
  - `mergeAdminPages()` → returns list for frontend admin shell rendering
  - `mergePaymentPurposes()` → adds module purposes to the payment purpose allow-list (extending the regex check from Phase 10B)

**Acceptance:**

- Types compile and module authors can write a module class implementing the interface
- Registry service compiles and stores registered modules
- Empty registry on boot does not break the system

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, SAZIQO_PLATFORM_PHASES_8_10.md, and
SAZIQO_PLATFORM_PHASES_11_13.md fully. Execute Phase 11A.

Build apps/api/src/core/module-registry/:
- types.ts: PlatformModule, PermissionDefinition, NotificationTypeDefinition,
  AdminPageDefinition, ModuleDeps interfaces per the plan
- module-registry.module.ts: NestJS module providing ModuleRegistryService
- module-registry.service.ts: implements register, getRegistered, getByName,
  getEnabledModules, and the four merge methods

mergePermissions implementation:
- For each enabled module, call registerPermissions()
- For each PermissionDefinition, upsert into Permission table
- For each defaultRoles, ensure RolePermission link exists
- Idempotent

mergeNotificationTypes:
- For each enabled module, call registerNotificationTypes()
- Append to NOTIFICATION_TEMPLATES at runtime via a registry pattern
  (NotificationsService gains a registerType(def) method)

mergeAdminPages:
- Returns sorted (by order, then by titleFa) list of all enabled modules'
  admin pages

mergePaymentPurposes:
- For each enabled module, call registerPaymentPurposes()
- Returns flat string array
- PaymentsService updated to accept this list at boot and use it in the
  allow-list check (replaces the regex /^[a-z_]+(:.+)?$/ from Phase 10B)

Add CLAUDE.md inside src/core/module-registry/ documenting:
- The contract is stable; breaking changes require a version bump
- Modules must NOT import from other modules — only from core/* and common/*
- Modules own table prefixes: agents_*, builders_*, etc.
- Modules call core services directly (no event bus in MVP)

Unit tests:
- Registry stores and retrieves modules
- Merge methods produce expected outputs given a mock module

Commit as "feat(phase-11A): add module contract and registry service".
```

---

## Phase 11B: Module Loader (boot-time discovery via modules.config.ts)

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** Loader runs before anything else. Bug = system can't boot.

**Deliverables:**

- `apps/api/src/modules.config.ts` — single static-import file:

  ```typescript
  // CLAUDE: Add new modules here. This file is the ONLY place modules
  // are listed. Static imports give compile-time type safety and avoid
  // dynamic file-system scanning.
  //
  // To add a module:
  //   1. Place the module under apps/api/src/modules/{name}/
  //   2. Export a default instance implementing PlatformModule
  //   3. Add an import + push to MODULES below
  //   4. Set enabled: true (or false to ship dark)

  import type { PlatformModule } from './core/module-registry/types';

  // import agentsModule from './modules/agents';
  // import buildersModule from './modules/builders';
  // import templatesModule from './modules/templates';

  export const MODULES: PlatformModule[] = [
    // agentsModule,
    // buildersModule,
  ];
  ```

- `apps/api/src/core/module-registry/module-loader.service.ts`:
  - Implements `OnApplicationBootstrap`
  - Reads `MODULES` from `modules.config.ts`
  - For each: calls `registry.register(module)`
  - Calls `registry.mergePermissions()` (extends Phase 4A's seed)
  - Calls `registry.mergeNotificationTypes()` (registers with NotificationsService)
  - Calls `registry.mergePaymentPurposes()` (extends Phase 10B's allow-list)
  - Calls `module.onBoot(deps)` for each enabled module
  - Logs `[module-loader] registered {moduleName} v{version}`
- `app.module.ts` updated to dynamically import each enabled module's `registerNestModule()` class — uses NestJS dynamic module pattern

**Acceptance:**

- Empty `MODULES` array → boot succeeds, log "no modules registered"
- Adding a mock module to `MODULES` → boot logs registration, merges permissions, mounts routes under `/api/v1/{moduleName}/`
- Disabled module (`enabled: false`) → skipped at boot, routes not mounted

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, SAZIQO_PLATFORM_PHASES_8_10.md, and
SAZIQO_PLATFORM_PHASES_11_13.md fully. Execute Phase 11B.

Create apps/api/src/modules.config.ts per the plan, with MODULES = []
initially (no modules yet) and the CLAUDE comment block.

Build apps/api/src/core/module-registry/module-loader.service.ts:
- Injected ModuleRegistryService, all core service deps for ModuleDeps
  hand-off
- Implements OnApplicationBootstrap.onApplicationBootstrap()
- Iterates MODULES, calls registry.register(module)
- After registration: mergePermissions, mergeNotificationTypes, merge
  PaymentPurposes
- For each enabled module: await module.onBoot(deps)
- For each enabled module on first boot (detect via a "modules_installed"
  table tracking installed module names + version): await module.onInstall
  (deps), then record in modules_installed
- Log every registration

Add Prisma migration for modules_installed table:
  model ModuleInstall {
    id          BigInt   @id @default(autoincrement())
    name        String   @unique @db.VarChar(60)
    version     String   @db.VarChar(20)
    installedAt DateTime @default(now())
  }

Update app.module.ts: gather each enabled module's registerNestModule()
result, add to imports array via dynamic module pattern. Document the
pattern in inline comments for future Claude sessions.

Add error code: MODULE_BOOT_FAILED (logged and rethrown to halt boot —
boot failure is loud and fatal; we never want a half-loaded system).

Add a smoke test in apps/api/test/integration/module-loader.spec.ts:
- Empty MODULES → boot succeeds
- Mock module → registers, merge methods called, onBoot invoked

Commit as "feat(phase-11B): add module loader with static import config".
```

---

## Phase 11C: Sample Mock Module to Verify the Contract

**Model: 🟢 Sonnet** | ~150 LOC

**Deliverables:**

- `apps/api/src/modules/_example/` — a non-shipping sample module that demonstrates the contract end-to-end:
  - `index.ts` — default export implementing `PlatformModule`
  - `example.module.ts` — NestJS module with one controller, one service
  - `example.controller.ts` — single endpoint `GET /api/v1/_example/ping` returning `{ data: { pong: true, persianName: 'مثال' } }`
  - `example.service.ts` — placeholder
  - `migrations/init.sql` — creates table `_example_pings` (just to prove migrations work)
  - One permission: `_example:read:ping`
  - One notification type: `_EXAMPLE_TEST` (not used in any flow, just registered)
  - One admin page definition: `/admin/_example` with permission `_example:moderate`
- `modules.config.ts` updated to import this module with `enabled: true` ONLY in `NODE_ENV=development` (or behind `ENABLE_EXAMPLE_MODULE` env flag — recommended pattern)
- After verification, leave the module in the codebase as a reference for future module authors. Mark with `// CLAUDE: Reference module — do not remove. New module authors copy this skeleton.`

**Acceptance:**

- Boot in dev → loader logs `[module-loader] registered _example v0.1.0`
- `GET /api/v1/_example/ping` returns 200 with expected body
- Permission `_example:read:ping` exists in `Permission` table after boot
- Disabling the module via env flag → routes return 404, permission stays in DB (deactivation does not delete history)

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, SAZIQO_PLATFORM_PHASES_8_10.md, and
SAZIQO_PLATFORM_PHASES_11_13.md fully. Execute Phase 11C.

Build apps/api/src/modules/_example/ as a complete reference module:
- index.ts: default export implementing PlatformModule with name
  '_example', persianName 'مثال', version '0.1.0', enabled from
  process.env.ENABLE_EXAMPLE_MODULE === 'true' (default true in dev)
- example.module.ts: NestJS module
- example.controller.ts: @Get('ping') @RequirePermission('_example:read:ping')
  returns { pong: true, persianName: 'مثال' }
- example.service.ts: placeholder
- registerPermissions returns:
  - { code: '_example:read:ping', description: 'Read example ping',
      persianDescription: 'خواندن پینگ مثال', defaultRoles: ['user', 'admin'] }
  - { code: '_example:moderate', description: 'Moderate example',
      persianDescription: 'مدیریت مثال', defaultRoles: ['admin'] }
- registerAuditActions returns { EXAMPLE_PINGED: 'EXAMPLE_PINGED' }
- registerNotificationTypes returns one _EXAMPLE_TEST entry
- registerAdminPages returns one entry
- registerPaymentPurposes returns ['_example_topup'] (proves the merge)
- onInstall: log "[_example] first install"
- onBoot: log "[_example] booted"

Add to modules.config.ts:
  import exampleModule from './modules/_example';
  export const MODULES: PlatformModule[] = [exampleModule];

Add to .env.example: ENABLE_EXAMPLE_MODULE=true
(in production this should be false; document this)

Add CLAUDE.md inside src/modules/_example/ explaining: this is a
reference module. Copy this skeleton when adding a new business module.

Verify:
- Boot in dev → registration log appears
- GET /api/v1/_example/ping with valid JWT + permission → 200
- Permission appears in DB
- Set ENABLE_EXAMPLE_MODULE=false → routes return 404 on next boot

Commit as "feat(phase-11C): add reference example module".
```

---

## Test Gate 11: Module Registry Verification

**Model: 🔴 Opus**

- [ ] Static `MODULES` array compiles with `pnpm typecheck`
- [ ] Boot with empty `MODULES` → API starts cleanly
- [ ] Boot with `_example` enabled → loader logs registration
- [ ] `_example` permissions appear in `Permission` table
- [ ] `_example` admin page appears in module-registry merge output
- [ ] `_example` payment purpose `_example_topup` accepted by Phase 10B's allow-list
- [ ] Disabling via env flag → routes return 404, permissions remain
- [ ] `module.onInstall` called once on first boot, `onBoot` on every boot
- [ ] Boot failure inside `onBoot` halts startup loudly (verify by throwing in mock)

---

# Phase Group 12 — Next.js Frontend Skeleton

## Phase 12A: Next.js Scaffold + Tailwind + shadcn/ui Init

**Model: 🟢 Sonnet** | ~150 LOC

**Deliverables:**

- `apps/web/` workspace with Next.js 15 App Router:
  - `package.json` with Next.js 15, React 19, TypeScript, Tailwind 4
  - `tsconfig.json` extending `packages/config/tsconfig.next.json`
  - `next.config.mjs` — minimal config: `reactStrictMode: true`, image optimization configured for self-hosted (no remote loaders), output `standalone` for Docker
  - `tailwind.config.ts` extending shared brand tokens (orange, ink, RTL-friendly utilities)
  - `postcss.config.mjs`
  - `src/app/layout.tsx` — root layout with `<html lang="fa" dir="rtl">`, Vazirmatn font, default metadata
  - `src/app/page.tsx` — minimal landing page placeholder ("سازیکو در حال راه‌اندازی")
  - `src/app/globals.css` — Tailwind directives + base styles
- shadcn/ui CLI initialized: `pnpm --filter web dlx shadcn@latest init` with config:
  - Style: `new-york`
  - Base color: `neutral` (we override with our orange/ink palette)
  - CSS variables: yes
  - RTL support enabled in component overrides
- Initial shadcn components installed: `button`, `input`, `label`, `card`, `toast` (via `sonner`)
- Empty `src/components/`, `src/lib/`, `src/hooks/`, `src/store/` directories with `.gitkeep`

**Acceptance:**

- `pnpm --filter web dev` starts on port 3000
- Visiting `http://localhost:3000` shows "سازیکو در حال راه‌اندازی" RTL
- Browser dev tools confirm `<html dir="rtl" lang="fa">`
- `pnpm --filter web typecheck` exits 0
- `pnpm --filter web build` succeeds

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, SAZIQO_PLATFORM_PHASES_8_10.md, and
SAZIQO_PLATFORM_PHASES_11_13.md fully. Execute Phase 12A.

Scaffold apps/web/ as a Next.js 15 App Router project:
- pnpm create next-app@latest apps/web --typescript --tailwind --eslint
  --app --src-dir --import-alias "@/*" --no-turbopack
  (or manual scaffold if create-next-app doesn't fit the workspace)
- package.json scripts: dev (next dev -p 3000), build (next build),
  start (next start -p 3000), lint, typecheck (tsc --noEmit)
- tsconfig.json extends packages/config/tsconfig.next.json
- next.config.mjs:
  - reactStrictMode: true
  - output: 'standalone' (for Docker production build)
  - images: { remotePatterns: [] } (self-hosted only — no external images
    by default)
  - experimental: { serverActions: { bodySizeLimit: '10mb' } }
- src/app/layout.tsx:
  - <html lang="fa" dir="rtl">
  - <body className={vazirmatn.className}>
  - default metadata (title: 'سازیکو', description placeholder)
- src/app/page.tsx: minimal placeholder centered "سازیکو در حال راه‌اندازی"
- src/app/globals.css: tailwind directives + base RTL fixes

Initialize shadcn/ui:
- pnpm --filter web dlx shadcn@latest init
- Choose: style new-york, base color neutral, CSS variables yes
- Add initial components: button, input, label, card, sonner

Verify pnpm --filter web dev runs and dev:typecheck passes.
Commit as "feat(phase-12A): scaffold next.js frontend with shadcn/ui".
```

---

## Phase 12B: Vazirmatn Font + RTL Config + Theme Tokens (orange + light)

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** Theme tokens lock visual fidelity for the whole app. Wrong values cascade.

**Deliverables:**

- `apps/web/public/fonts/vazirmatn/` — same five `.woff2` weights used in the website plan (400, 500, 600, 700, 800), self-hosted
- `apps/web/src/app/fonts.ts`:
  ```typescript
  import localFont from 'next/font/local';
  export const vazirmatn = localFont({
    src: [
      { path: '../../public/fonts/vazirmatn/Vazirmatn-Regular.woff2', weight: '400' },
      { path: '../../public/fonts/vazirmatn/Vazirmatn-Medium.woff2', weight: '500' },
      { path: '../../public/fonts/vazirmatn/Vazirmatn-SemiBold.woff2', weight: '600' },
      { path: '../../public/fonts/vazirmatn/Vazirmatn-Bold.woff2', weight: '700' },
      { path: '../../public/fonts/vazirmatn/Vazirmatn-ExtraBold.weight: '800' },
    ],
    display: 'swap',
    variable: '--font-vazirmatn',
  });
  ```
- `apps/web/tailwind.config.ts` extended with brand tokens:
  ```typescript
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0f172a', 2: '#1f2937', 3: '#334155',
               dim: '#64748b', faint: '#94a3b8' },
        line: { DEFAULT: '#e2e8f0', strong: '#cbd5e1' },
        orange: { DEFAULT: '#f97316', soft: '#ffedd5', deep: '#ea580c',
                  faint: '#fff7ed' },
        bg: { DEFAULT: '#ffffff', soft: '#f8fafc', section: '#f1f5f9' },
      },
      fontFamily: { sans: ['var(--font-vazirmatn)', 'system-ui', 'sans-serif'] },
      borderRadius: { sm: '8px', md: '12px', lg: '16px', xl: '24px' },
    },
  }
  ```
- `apps/web/src/app/globals.css` — CSS variables that mirror Tailwind tokens (for shadcn/ui's CSS-variable-based theming):
  ```css
  :root {
    --background: 0 0% 100%;
    --foreground: 222 47% 11%; /* ink */
    --primary: 21 90% 53%; /* orange */
    --primary-foreground: 0 0% 100%;
    --muted: 210 40% 96%; /* bg-soft */
    --muted-foreground: 215 16% 47%; /* ink-dim */
    --border: 214 32% 91%; /* line */
    /* ... all shadcn semantic tokens mapped to brand palette */
    --radius: 12px;
  }
  ```
- All shadcn/ui components inherit these tokens automatically — no per-component theming
- Verify shadcn `<Button variant="default">` renders orange

**Acceptance:**

- Vazirmatn loads (Network tab: 5 woff2 files 200 OK)
- `<Button>` renders with brand orange background
- All shadcn primitives respect light theme (no dark mode in v1)
- Body text uses Vazirmatn

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, SAZIQO_PLATFORM_PHASES_8_10.md, and
SAZIQO_PLATFORM_PHASES_11_13.md fully. Execute Phase 12B.

Download Vazirmatn .woff2 (weights 400, 500, 600, 700, 800) from
https://github.com/rastikerdar/vazirmatn/releases/latest into
apps/web/public/fonts/vazirmatn/.

Create apps/web/src/app/fonts.ts using next/font/local per the plan.
Apply vazirmatn.variable to <html> in layout.tsx so the CSS variable
is available globally.

Update apps/web/tailwind.config.ts theme.extend per the plan exactly:
brand colors (ink, line, orange, bg families), fontFamily.sans pointing
at var(--font-vazirmatn), borderRadius scale.

Update apps/web/src/app/globals.css with the CSS variable map per the
plan, mapping shadcn's semantic tokens to brand palette HSL values.
Light mode only — no @media (prefers-color-scheme: dark) overrides.

Verify:
- Vazirmatn loads in Network tab
- Default <Button> from shadcn renders orange (#f97316)
- Body text is Vazirmatn (inspect computed font-family)

Commit as "feat(phase-12B): add vazirmatn font and brand theme tokens".
```

---

## Phase 12C: API Client (fetch wrapper + auth token + refresh rotation)

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** API client is the single point of contact with the backend. Bug in token handling = users logged out unexpectedly.

**Deliverables:**

- `apps/web/src/lib/api-client.ts`:
  - Fetch wrapper class `ApiClient`
  - Methods: `get`, `post`, `patch`, `delete`, `upload` (multipart)
  - Adds `Authorization: Bearer {accessToken}` from auth store
  - Adds `Accept-Language: fa-IR`, `X-Request-Id` (uuid v4 per request)
  - Auto-handles `401 TOKEN_EXPIRED`:
    1. Pause incoming request
    2. Call `POST /api/v1/auth/refresh` (cookie sent automatically)
    3. On success → store new access token in auth store, retry original request
    4. On failure → clear auth store, redirect to `/login`
  - **Single-flight refresh**: if multiple requests fire 401 simultaneously, only one refresh call happens; others wait for it
  - Errors normalized to `{ code, message, details, status }`
  - Persian error messages displayed via toast (sonner) for unhandled errors
- `apps/web/src/lib/idempotency.ts`:
  - `generateIdempotencyKey()` — uuid v4 — used by mutation hooks for `Idempotency-Key` header
  - `withIdempotency(operation, fn)` — generates a key keyed by an operation name + body hash, persists in `sessionStorage` so reload doesn't double-submit

**Acceptance:**

- `apiClient.get('/users/me')` returns `{ data: { ... } }`
- 401 response triggers transparent refresh + retry
- Concurrent 401s trigger only ONE refresh call (verifiable via network panel)
- Failed refresh redirects to `/login`
- Mutation requests carry `Idempotency-Key` automatically when wrapped

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, SAZIQO_PLATFORM_PHASES_8_10.md, and
SAZIQO_PLATFORM_PHASES_11_13.md fully. Execute Phase 12C.

Install: uuid (and @types/uuid).

Build apps/web/src/lib/api-client.ts:
- ApiClient class (singleton via export default new ApiClient())
- baseURL from process.env.NEXT_PUBLIC_API_BASE_URL (default
  http://localhost:3001)
- Methods: get(path, options?), post(path, body?, options?), patch,
  delete, upload(path, formData, options?)
- options: { idempotencyKey?, signal? (AbortController), skipAuth? }
- Each request:
  - Generates X-Request-Id (uuid v4)
  - Adds Authorization: Bearer {accessToken from authStore} unless skipAuth
  - Adds Accept-Language: fa-IR
  - On Idempotency-Key option, sets header
  - On 401 TOKEN_EXPIRED: enter refresh flow
- Refresh flow with single-flight:
  - Class-level refreshPromise: Promise<void> | null = null
  - On 401: if refreshPromise exists, await it; otherwise:
    refreshPromise = doRefresh()
    try { await refreshPromise; retry original request }
    finally { refreshPromise = null }
  - doRefresh: POST /api/v1/auth/refresh (credentials: include for cookie),
    on success update authStore.accessToken, on failure clear authStore
    and window.location = '/login'
- Error normalization:
  - Parse response body as { error: { code, message, details } }
  - Throw ApiError instance with .status, .code, .message, .details
- Toast for unhandled errors: useGlobalErrorToast hook (created in 13B
  context) — for now, console.error placeholder

Build apps/web/src/lib/idempotency.ts:
- generateIdempotencyKey(): string (uuid v4)
- withIdempotency<T>(operation: string, bodyHash: string, fn: (key:
  string) => Promise<T>): persists key in sessionStorage under
  `idem:${operation}:${bodyHash}`, reuses on retry

Add to .env.example for web: NEXT_PUBLIC_API_BASE_URL=http://localhost:3001

Unit tests with mocked fetch:
- Successful GET returns parsed body
- 401 triggers refresh + retry
- Concurrent 401s share one refresh
- Failed refresh redirects to /login
- Idempotency key persists in sessionStorage

Commit as "feat(phase-12C): add api client with refresh rotation and
idempotency".
```

---

## Phase 12D: Auth State (Zustand) + useAuth Hook

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** Auth state is read by every guarded route. Wrong shape = repeated bug fixes everywhere.

**Deliverables:**

- `apps/web/src/store/auth.store.ts` — Zustand store:

  ```typescript
  interface AuthState {
    accessToken: string | null;
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean; // initial bootstrap from refresh
    profileComplete: boolean;
    isImpersonating: boolean;
    impersonationActorId: string | null;

    // Actions
    bootstrap: () => Promise<void>; // called on app mount
    setAuth: (accessToken: string, user: User) => void;
    clearAuth: () => void;
    refreshUser: () => Promise<void>; // reload /users/me
  }
  ```

- Persistence: `accessToken` is **not** persisted to localStorage (refresh cookie + bootstrap call rebuilds it on reload). User info cached in memory only.
- `apps/web/src/hooks/use-auth.ts` — read-only hook for components:
  ```typescript
  export function useAuth() {
    const { user, isAuthenticated, isLoading, profileComplete, ... } = useAuthStore();
    return { user, isAuthenticated, isLoading, profileComplete, ... };
  }
  ```
- `apps/web/src/components/auth/auth-bootstrap.tsx` — client component placed in root layout, calls `bootstrap()` on mount
- Bootstrap flow:
  1. Try `POST /api/v1/auth/refresh` (cookie sent automatically)
  2. On success: store access token, fetch `/users/me`, store user
  3. On failure: clear state, set `isAuthenticated: false`
  4. Set `isLoading: false`
- Components display loading skeleton while `isLoading: true` to prevent flash of unauthenticated state

**Acceptance:**

- App loads → bootstrap runs → if cookie valid, user is logged in without re-entering OTP
- After OTP verify, `setAuth` populates store
- After logout, `clearAuth` empties store and removes cookie via `/auth/logout`
- `useAuth()` returns reactive state to components

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, SAZIQO_PLATFORM_PHASES_8_10.md, and
SAZIQO_PLATFORM_PHASES_11_13.md fully. Execute Phase 12D.

Install: zustand.

Build apps/web/src/store/auth.store.ts:
- Zustand store with shape per the plan
- bootstrap action:
  1. set isLoading: true
  2. try await apiClient.post('/auth/refresh', null, { skipAuth: true })
     (cookie sent automatically because we use credentials: 'include'
     in api-client)
  3. On success:
     - response.data.accessToken stored
     - await apiClient.get('/users/me')
     - response.data is user; set state
     - profileComplete = user.status === 'ACTIVE'
     - isImpersonating from JWT claim 'imp' (decode JWT client-side
       just for UX flag; server is the source of truth)
  4. On failure: clearAuth()
  5. finally: set isLoading: false
- setAuth: stores token and user
- clearAuth: zeros all fields, isAuthenticated = false
- refreshUser: re-fetches /users/me

Build apps/web/src/hooks/use-auth.ts: exports useAuth with read-only
selectors using zustand's selector pattern for performance.

Build apps/web/src/components/auth/auth-bootstrap.tsx:
- 'use client' component
- useEffect on mount → calls authStore.bootstrap()
- Renders children unconditionally (no UI of its own)

Update apps/web/src/app/layout.tsx: wrap children in AuthBootstrap.

Add helper apps/web/src/lib/jwt-decode.ts: small client-side JWT
payload decoder (no signature verification — server validates) to read
'imp' claim for the isImpersonating flag.

Unit tests for store actions with mocked apiClient.

Commit as "feat(phase-12D): add zustand auth store and useAuth hook".
```

---

## Phase 12E: shadcn/ui Persian RTL Primitives Audit + Patches

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** shadcn/ui defaults to LTR. Subtle visual bugs in dropdowns, sliders, toasts, dialogs — all need RTL adjustment.

**Deliverables:**

- Audit installed shadcn primitives for RTL issues:
  - **Button**: icons on right side need flipping (`gap`, `flex-row-reverse` where icon precedes text)
  - **Input**: cursor direction, placeholder alignment — usually fine but verify with Persian text
  - **Select / Dropdown / Combobox**: animation direction, chevron icon side
  - **Toast (sonner)**: position default top-right → top-left for RTL (or top-center to sidestep)
  - **Dialog**: close-X icon position
  - **Sheet (drawer)**: side defaults left/right need inversion mapping for RTL
  - **Toggle / Switch**: thumb starts on the wrong side in RTL
  - **Calendar / DatePicker**: Persian/Jalali calendar — defer to v1.5 (Gregorian is acceptable for MVP admin views; user-facing dates rendered as text)
  - **Tooltip**: arrow direction
- Create `apps/web/src/components/ui/` overrides where shadcn defaults are wrong, mostly via `dir` and Tailwind `rtl:` variants
- Document each patch with `// CLAUDE: RTL fix — original shadcn code does X, RTL needs Y`
- `apps/web/src/components/ui/toast.tsx` — wraps `sonner` Toaster with `position="top-left"` and `dir="rtl"`
- Add `@tailwindcss/forms` plugin if needed for native inputs alignment (Persian numerals in number inputs)

**Acceptance:**

- All currently-installed primitives visually correct in RTL
- Toast appears top-left
- Switch thumb starts on right side when off
- Dropdowns animate from correct origin
- Persian text placeholder visible and aligned right

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, SAZIQO_PLATFORM_PHASES_8_10.md, and
SAZIQO_PLATFORM_PHASES_11_13.md fully. Execute Phase 12E.

Audit each installed shadcn/ui component in apps/web/src/components/ui/
for RTL issues. For each, identify the LTR assumption and patch with
either dir="rtl" or rtl:* Tailwind variants.

Specifically:
- button.tsx: ensure icon-with-text variants use flex-row-reverse in
  RTL when icon precedes text in source order
- input.tsx: verify cursor + placeholder; usually OK
- select.tsx and dropdown-menu.tsx: chevron should be on left side in
  RTL (rtl:left-2 instead of right-2); animation origin updated
- sonner.tsx wrapper: <Toaster position="top-left" dir="rtl" />
- dialog.tsx: close button positioned start-side (left in RTL)
- sheet.tsx: side prop "right" in RTL means visually-right of viewport;
  document the mapping clearly
- switch.tsx: thumb default position needs RTL inversion via
  data-[state=checked]:translate-x-[-1.25rem] on RTL
- tooltip.tsx: side prop semantics maintain visual side in RTL

For each patch, add a CLAUDE comment explaining the change.

Create a visual sandbox page at apps/web/src/app/_dev/components/page.tsx
(only enabled in NODE_ENV=development) that renders every primitive with
Persian content for visual verification. Add CLAUDE comment that this
page is dev-only and should not ship.

Verify visually in dev:
- All primitives render correctly in RTL
- Toast shows top-left
- Switch thumb starts on right (off state)

Commit as "feat(phase-12E): patch shadcn/ui primitives for persian rtl".
```

---

## Test Gate 12: Frontend Skeleton Verification

**Model: 🔴 Opus**

- [ ] `pnpm --filter web dev` starts on port 3000
- [ ] `pnpm --filter web build` succeeds
- [ ] `pnpm --filter web typecheck` exits 0
- [ ] Landing page renders Persian text RTL
- [ ] Vazirmatn font loads (Network tab confirms)
- [ ] Brand orange visible on default `<Button>`
- [ ] All installed shadcn primitives render correctly in RTL (sandbox page)
- [ ] API client successfully calls `/api/v1/health` from frontend (with CORS)
- [ ] Auth bootstrap runs on mount (verify console log: "[auth] bootstrap done")
- [ ] No console errors

---

# Phase Group 13 — Auth UI

## Phase 13A: Phone Entry Page (Iranian format validation)

**Model: 🟢 Sonnet** | ~180 LOC

**Deliverables:**

- `apps/web/src/app/(auth)/login/page.tsx` — phone entry page
- `apps/web/src/app/(auth)/layout.tsx` — auth-area layout (centered card, brand logo, no nav)
- Phone input:
  - Persian-friendly: accepts `09XXXXXXXXX`, `+989XXXXXXXXX`, `989XXXXXXXXX`
  - LTR direction inside the input even though page is RTL (numbers ltr correctly)
  - Inline validation: green check on valid, red message on invalid
  - Persian numeral input is also accepted; converted to Latin before submit
- Submit:
  - Calls `POST /api/v1/auth/otp/request` via api client with `Idempotency-Key`
  - On success: navigates to `/login/verify?phone={normalized-e164}` (query param keeps phone visible across navigation; no PII in URL bar warnings since this is the user's own phone)
  - On `OTP_RATE_LIMITED`: shows toast with seconds-until-retry countdown
  - On `RATE_LIMITED` (IP-level): shows toast "تعداد درخواست‌ها زیاد است. لطفاً بعداً تلاش کنید."
- Loading state: button disabled, spinner inside button
- Branding: saziqo logo + Persian tagline above the form

**Acceptance:**

- Valid phone → request sent → navigates to verify page
- Invalid phone → inline validation error, no submit
- Rate limit → user sees friendly Persian message
- Persian numerals in input work correctly

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, SAZIQO_PLATFORM_PHASES_8_10.md, and
SAZIQO_PLATFORM_PHASES_11_13.md fully. Execute Phase 13A.

Build apps/web/src/app/(auth)/layout.tsx:
- Centered card layout (max-w-md, mx-auto, mt-16)
- Saziqo logo at top
- Persian tagline "ورود به سازیکو"
- Card containing children

Build apps/web/src/app/(auth)/login/page.tsx:
- 'use client'
- Form with shadcn Input + Button
- Phone field:
  - dir="ltr" inside input (numbers visualized LTR)
  - placeholder "۰۹۱۲۳۴۵۶۷۸۹"
  - On change: convert Persian numerals to Latin (use a small helper
    @saziqo/persian-utils that exposes toLatinDigits)
  - Validate via @saziqo/persian-utils isValidIranianPhone — show
    inline check icon (green) when valid, error text when invalid
- Submit handler:
  - normalizeIranianPhone(input)
  - apiClient.post('/auth/otp/request', { phone }, { idempotencyKey:
    generateIdempotencyKey() })
  - On 200: router.push(`/login/verify?phone=${encodeURIComponent(phone)}`)
  - On 429 OTP_RATE_LIMITED: extract retryAfterSeconds from error.details,
    toast with countdown
  - On other errors: toast with error.message

Add helper to packages/persian-utils/src/numerals.ts:
- toLatinDigits(input: string): string — converts ۰-۹ → 0-9
- toPersianDigits(input: string): string — converts 0-9 → ۰-۹

Update persian-utils package exports.

Verify in dev:
- Enter Persian numerals → submits successfully
- Invalid → error shown
- Server log shows OTP

Commit as "feat(phase-13A): add phone entry page".
```

---

## Phase 13B: OTP Entry Page (6-digit input, countdown, resend)

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** OTP entry UX directly affects auth conversion. Bugs here = users locked out.

**Deliverables:**

- `apps/web/src/app/(auth)/login/verify/page.tsx`:
  - Reads `phone` from query param (validate format, redirect to `/login` if missing or invalid)
  - 6-digit OTP input:
    - Six separate boxes connected via auto-advance (when typing, focus moves to next; backspace returns)
    - Accepts paste of full 6-digit code
    - Persian numerals accepted, converted to Latin
    - LTR rendering even on RTL page
  - Countdown timer: 120 seconds, displayed under the input
  - Resend button: disabled until countdown reaches 0
  - On full 6 digits entered: auto-submit
  - Submit:
    - `POST /api/v1/auth/otp/verify` with `{ phone, code }`
    - With `Idempotency-Key`
    - On success: `authStore.setAuth(token, user)`, then:
      - If `profileComplete: true` → navigate to `/dashboard`
      - If `profileComplete: false` → navigate to `/onboarding/profile`
    - On `OTP_INVALID` / `OTP_EXPIRED`: show toast, allow retry
    - On `OTP_TOO_MANY_ATTEMPTS`: show toast "تعداد تلاش‌ها بیش از حد. لطفاً کد جدید درخواست کنید."
- Resend handler: re-calls `/auth/otp/request`, resets countdown
- Optional: a small "تغییر شماره" link returns to `/login`

**Acceptance:**

- Auto-advance works between boxes
- Paste of 6 digits fills all boxes
- Auto-submit on completion
- Countdown ticks every second
- Resend disabled during countdown
- Successful login navigates to correct destination based on profileComplete
- Failed OTP allows retry without losing the current code in input (user can edit)

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, SAZIQO_PLATFORM_PHASES_8_10.md, and
SAZIQO_PLATFORM_PHASES_11_13.md fully. Execute Phase 13B.

Install shadcn input-otp component:
  pnpm --filter web dlx shadcn@latest add input-otp

Build apps/web/src/app/(auth)/login/verify/page.tsx:
- 'use client'
- useSearchParams to read phone; validate via isValidIranianPhone, else
  router.push('/login')
- shadcn InputOTP component for 6-digit entry, configured with REGEXP_ONLY_DIGITS
- Local state: code (string), countdown (number, init 120), isSubmitting
- useEffect: setInterval to decrement countdown each second; clear on
  unmount
- onComplete handler (fired by InputOTP when 6 digits entered):
  - setIsSubmitting(true)
  - apiClient.post('/auth/otp/verify', { phone, code }, { idempotencyKey })
  - On success:
    - authStore.setAuth(response.data.accessToken, response.data.user)
    - profileComplete = response.data.profileComplete
    - router.push(profileComplete ? '/dashboard' : '/onboarding/profile')
  - On error: toast with mapped Persian message; setCode(''); setIsSubmitting(false)
- Resend button: disabled when countdown > 0
  - On click: re-call apiClient.post('/auth/otp/request', { phone }),
    reset countdown to 120, toast "کد جدید ارسال شد"
- "تغییر شماره" link → /login

Use a Persian message map for OTP error codes:
  OTP_INVALID: "کد وارد شده نادرست است"
  OTP_EXPIRED: "کد منقضی شده است. کد جدید درخواست کنید"
  OTP_TOO_MANY_ATTEMPTS: "تعداد تلاش‌ها بیش از حد. کد جدید درخواست کنید"
  OTP_RATE_LIMITED: "لطفاً ${seconds} ثانیه صبر کنید"

The InputOTP component must accept Persian numerals (use the Persian
→ Latin conversion in onChange before submit; InputOTP supports
inputMode="numeric").

Verify in dev: full flow works, countdown ticks, resend works after
countdown.

Commit as "feat(phase-13B): add otp verify page with countdown".
```

---

## Phase 13C: Profile Completion Page

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Mandatory gate page. Bugs here = users stuck in PENDING_PROFILE forever.

**Deliverables:**

- `apps/web/src/app/(account)/onboarding/profile/page.tsx`:
  - Renders only if `profileComplete === false`; if `true`, redirect to `/dashboard`
  - Form with shadcn Input fields:
    - First name (`firstName`) — Persian-only validation regex `/^[\u0600-\u06FF\s]+$/`
    - Last name (`lastName`) — same
    - National ID (`nationalId`) — 10 digits, Iranian checksum (use `@saziqo/persian-utils`)
    - Email (`email`) — RFC 5322
  - Each field has inline validation feedback
  - Submit:
    - `POST /api/v1/users/me/complete-profile` with all fields
    - With `Idempotency-Key`
    - On success:
      - `authStore.refreshUser()` (re-fetch /users/me to update profileComplete)
      - Navigate to `/dashboard`
      - Toast: "پروفایل شما تکمیل شد. خوش آمدید!"
    - On `CONFLICT` (duplicate national ID or email): show specific error on the offending field
    - On `VALIDATION_ERROR`: map field-level errors back to form
- This page is also accessible from menu later (for editing — but in MVP, name/national ID immutable after first save; update endpoint deferred)

**Acceptance:**

- New user lands here after first OTP verify
- All four fields validated client-side AND server-side
- Duplicate national ID → shown on the right field, not generic toast
- Successful submission → user becomes ACTIVE, redirected to dashboard
- Already-complete user → auto-redirected to dashboard

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, SAZIQO_PLATFORM_PHASES_8_10.md, and
SAZIQO_PLATFORM_PHASES_11_13.md fully. Execute Phase 13C.

Install: react-hook-form, @hookform/resolvers, zod (already at root).

Build apps/web/src/app/(account)/layout.tsx:
- Authenticated layout (uses useAuth — if !isAuthenticated, redirect to /login)
- Renders children with simple max-w-2xl center

Build apps/web/src/app/(account)/onboarding/profile/page.tsx:
- 'use client'
- useEffect: if user.profileComplete → router.push('/dashboard')
- Zod schema in apps/web/src/lib/schemas/profile.schema.ts:
  z.object({
    firstName: z.string().min(2).regex(/^[\u0600-\u06FF\s]+$/, 'فقط فارسی'),
    lastName: z.string().min(2).regex(/^[\u0600-\u06FF\s]+$/, 'فقط فارسی'),
    nationalId: z.string().length(10).refine(isValidIranianNationalId,
                  'کد ملی نامعتبر'),
    email: z.string().email('ایمیل نامعتبر'),
  })
- react-hook-form with zodResolver, fields wired to shadcn Input via
  Controller or register
- Submit:
  - apiClient.post('/users/me/complete-profile', data, { idempotencyKey })
  - On success: await authStore.refreshUser(); toast success;
    router.push('/dashboard')
  - On 409 CONFLICT: extract field from error.details (server returns
    which field violated unique constraint); set form error on that field
  - On 400 VALIDATION_ERROR: map error.details to form errors via
    setError per field

Persian error messages in Zod schema must be user-facing.

Verify in dev:
- New user lands here after OTP
- Persian name validation works
- Invalid national ID rejected client-side
- Server-side dupe → field-level error shown

Commit as "feat(phase-13C): add profile completion page".
```

---

## Phase 13D: Logout Flow + Active Sessions Page

**Model: 🟢 Sonnet** | ~180 LOC

**Deliverables:**

- Logout:
  - User menu (in header — built in Phase 14B) calls `apiClient.post('/auth/logout')`
  - Then `authStore.clearAuth()`
  - Then `router.push('/login')`
  - Toast: "خروج با موفقیت انجام شد"
- `apps/web/src/app/(account)/settings/sessions/page.tsx`:
  - Lists active sessions via `GET /api/v1/users/me/sessions`
  - Each row: device info (parsed from User-Agent — use `ua-parser-js`), IP address (masked except last octet), `lastSeenAt` formatted Jalali, "دستگاه فعلی" badge for the current session (sid in JWT matches)
  - "خروج" button per row → `DELETE /api/v1/users/me/sessions/:id`
  - "خروج از همه دستگاه‌های دیگر" button → `DELETE /api/v1/users/me/sessions`
  - Confirmation dialog (shadcn AlertDialog) before any revocation
- Use `date-fns-jalali` or `dayjs` with Jalali plugin for date display

**Acceptance:**

- Logout clears state, navigates to login, toast shown
- Sessions page lists 1+ sessions
- Current session marked with badge
- Revoking another session removes it from list
- Revoke-all-others keeps only current

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, SAZIQO_PLATFORM_PHASES_8_10.md, and
SAZIQO_PLATFORM_PHASES_11_13.md fully. Execute Phase 13D.

Install: ua-parser-js, dayjs, dayjs-jalali (or jalaali-js).

Build apps/web/src/lib/logout.ts:
- async logout(): calls apiClient.post('/auth/logout'), then
  authStore.clearAuth(), then window.location = '/login'
- Used by user menu (Phase 14B)

Build apps/web/src/app/(account)/settings/sessions/page.tsx:
- 'use client'
- Use SWR or react-query for /users/me/sessions data fetching (install
  @tanstack/react-query and set up provider in root layout)
- For each session: parse userAgent via ua-parser-js, render device +
  browser + OS
- IP masked: "192.168.*.42" pattern
- lastSeenAt formatted via dayjs jalali plugin: "۲ ساعت پیش", "دیروز",
  full date for older
- Current session: compare session.id to JWT sid claim → "دستگاه فعلی"
  badge
- Revoke button per non-current row: opens AlertDialog "آیا از خروج این
  نشست مطمئن هستید؟" → on confirm, DELETE /users/me/sessions/:id, refetch
- Revoke-all-others button at top: AlertDialog → DELETE /users/me/sessions,
  refetch

Add helper apps/web/src/lib/dates.ts:
- formatJalaliRelative(date: Date | string): string — "۲ ساعت پیش"
- formatJalaliFull(date: Date | string): string — "۱۴۰۵/۰۲/۱۲ ۱۴:۳۰"

Verify in dev:
- Log in twice (two browsers) → sessions page shows 2
- Revoke other → that browser's next API call returns 401
- Revoke-all-others → only current remains

Commit as "feat(phase-13D): add logout flow and sessions page".
```

---

## Test Gate 13: Full Auth Flow End-to-End on Web

**Model: 🔴 Opus**

- [ ] Phone entry page accepts Iranian formats (Latin and Persian numerals)
- [ ] Invalid phone → inline error, no submit
- [ ] OTP request → navigates to verify page
- [ ] OTP verify page: 6-box input, auto-advance, paste works
- [ ] Countdown ticks; resend disabled during countdown
- [ ] Successful OTP for new user → profile completion page
- [ ] Successful OTP for existing user → dashboard
- [ ] Profile completion validates Persian names, national ID checksum, email
- [ ] Server-side duplicate national ID → field-level error shown
- [ ] Logout clears state and navigates to login
- [ ] Sessions page lists, marks current, revokes others
- [ ] Reload after login → bootstrap re-establishes session via refresh cookie
- [ ] All error messages in Persian
- [ ] No console errors during full flow
- [ ] Mobile viewport (375px) renders correctly

---

# What Comes After Phase Group 13

You now have:

- Module registry with static loader and reference example module
- Next.js frontend skeleton with brand theme, RTL, shadcn/ui patched
- API client with auto-refresh and idempotency
- Zustand auth store with bootstrap on app load
- Full auth UI: phone entry → OTP verify → profile completion → dashboard handoff
- Active sessions management

**Next:** Phase Groups 14–16 (Layout & Admin Shell, Production Hardening, Release Pipeline) — `platform-phases-14-16.md`.
