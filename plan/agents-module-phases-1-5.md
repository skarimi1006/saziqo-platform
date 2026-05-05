# سازیکو Agents Marketplace Module — Phase Groups 1–5 (Executable)

> Read alongside `agents-module-plan.md` (master skeleton) and the system plan files (`platform-system-plan.md`, `platform-phases-1-4.md` through `platform-phases-14-16.md`). Skeleton's locked decisions win on conflict; this file is authoritative for per-phase execution. Per-phase rules and conventions identical to the system plan.

---

## Pre-execution Prerequisites

Before Claude Code runs Phase 1A:

1. **System layer Phase Groups 1–11 deployed and stable** — auth, RBAC, audit, files, notifications, ledger, payments (with console adapter), module registry all working
2. **Super_admin can access `/admin` and reach `/admin/_example/ping`** — confirms module-loading baseline from system Phase 11C
3. **At least one test purchase completed end-to-end via system Phase Group 10's console payment adapter** — confirms payment infrastructure ready for when real payments turn on
4. **System Phase Group 14 admin shell working** — admin pages render; we'll add agents admin pages on top
5. **Repo structure:** `apps/api/src/modules/` exists (created in system Phase 11A)
6. **Brand assets locked** — `vazirmatn` font, brand orange `#f97316`, light theme tokens all in place from system Phase 12B

---

# Phase Group 1 — Module Foundation

## Phase 1A: Module Scaffold + Prisma Schema + Append-only Triggers

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Schema decisions cascade into every later phase. Wrong types here are expensive to undo.

**Deliverables:**

- Directory: `apps/api/src/modules/agents/`
  ```
  agents/
    index.ts                       # default export of PlatformModule instance
    agents.module.ts               # NestJS module
    constants.ts                   # category seed, default settings, pricing types in TS
    types.ts                       # internal TS types
    services/.gitkeep
    controllers/.gitkeep
    dto/.gitkeep
    CLAUDE.md                      # module context for future Claude sessions
  ```
- Prisma schema additions appended to `apps/api/prisma/schema.prisma` for all tables/enums per master plan:
  - `agents_category`, `agents_listing`, `agents_screenshot`, `agents_run_pack`
  - `agents_cart_item`
  - `agents_purchase`, `agents_user_runs`, `agents_run_event`
  - `agents_review`
  - `agents_settings`
  - All enums: `AgentsPricingType`, `AgentsListingStatus`, `AgentsPurchaseStatus`, `AgentsRunOutcome`
- Migration created: `agents_module_init`
- Second migration `agents_append_only_triggers` adds DB triggers preventing UPDATE/DELETE on `agents_run_event` (only — `agents_purchase` is mutable for refund status, documented exception)
- All FKs to system tables (`User`, `File`, `Payment`) resolve correctly

**Acceptance criteria:**

- `pnpm --filter api db:migrate-dev --name agents_module_init` succeeds
- All tables exist with correct columns via `make db-shell`
- Manual `UPDATE agents_run_event SET outcome = 'X'` via psql → fails with trigger error
- Manual `UPDATE agents_purchase SET status = 'REFUNDED'` via psql → succeeds (intentional)
- Polymorphic cart shape: `agents_cart_item.listingId` is non-nullable now; later modules reuse the cart concept by adding sibling tables (templates_cart_item, etc.) with the same shape

**Claude Code prompt:**

```
Read the system plan files (PLATFORM_SYSTEM_PLAN.md and the phases-1-4
through phases-14-16 files) plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 1A.

Create directory apps/api/src/modules/agents/ with the file structure
listed in the plan.

Append schema models from AGENTS_MODULE_PLAN.md "Database Schema"
section to apps/api/prisma/schema.prisma. All model names lowercase
prefixed: agents_category, agents_listing, agents_screenshot,
agents_run_pack, agents_cart_item, agents_purchase, agents_user_runs,
agents_run_event, agents_review, agents_settings.

Add Prisma enums: AgentsPricingType, AgentsListingStatus,
AgentsPurchaseStatus, AgentsRunOutcome.

Foreign key references to system tables:
- agents_listing.makerUserId → User.id
- agents_listing.bundleFileId → File.id (nullable — set after upload)
- agents_screenshot.fileId → File.id
- agents_screenshot.listingId → agents_listing.id (cascade)
- agents_run_pack.listingId → agents_listing.id (cascade)
- agents_cart_item.userId → User.id (nullable for guest carts merged in)
- agents_cart_item.listingId → agents_listing.id (cascade)
- agents_cart_item.runPackId → agents_run_pack.id (nullable)
- agents_purchase.userId → User.id
- agents_purchase.listingId → agents_listing.id
- agents_purchase.runPackId → agents_run_pack.id (nullable)
- agents_purchase.systemPaymentId → Payment.id (nullable for now)
- agents_user_runs.userId → User.id
- agents_user_runs.listingId → agents_listing.id (cascade)
- agents_run_event.userId → User.id
- agents_run_event.listingId → agents_listing.id
- agents_review.listingId → agents_listing.id (cascade)
- agents_review.authorUserId → User.id

Run pnpm --filter api db:migrate-dev --name agents_module_init.

Then create a SECOND migration via prisma migrate dev --create-only
named agents_append_only_triggers, hand-write the SQL:

CREATE OR REPLACE FUNCTION prevent_agents_run_event_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'agents_run_event is append-only — % not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agents_run_event_no_update
BEFORE UPDATE ON agents_run_event
FOR EACH ROW EXECUTE FUNCTION prevent_agents_run_event_modification();

CREATE TRIGGER agents_run_event_no_delete
BEFORE DELETE ON agents_run_event
FOR EACH ROW EXECUTE FUNCTION prevent_agents_run_event_modification();

Apply with pnpm migrate dev.

Create apps/api/src/modules/agents/CLAUDE.md with:
- Module purpose: two-sided marketplace for AI agents
- Locked decisions: light theme + terminal accents, manual review,
  hybrid cart, 20% commission default, run packs cumulative
- Pricing types: FREE, ONE_TIME, PER_RUN
- Module owns all agents_* tables; reads from system services
  (PaymentsService, NotificationsService, FilesService, AuditService,
  LedgerService) but does NOT cross-import from other modules
- All public routes under /api/v1/agents/...
- Frontend route map (public, account, admin)

Verify via make db-shell:
- All agents_* tables exist with correct columns
- Trigger error fires on UPDATE/DELETE of agents_run_event
- agents_purchase still allows UPDATE (refund flow — documented exception)

Commit as "feat(agents-1A): scaffold module + prisma schema + triggers".
```

---

## Phase 1B: PlatformModule Contract Implementation

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Contract registration touches every system service. Mistakes cause boot failures or silent gaps.

**Deliverables:**

- `apps/api/src/modules/agents/index.ts` — default export of `PlatformModule`
- `apps/api/src/modules/agents/contract.ts` — exports five constants imported by index.ts:
  - `AGENTS_PERMISSIONS` (14 entries per master plan)
  - `AGENTS_AUDIT_ACTIONS` (18 entries)
  - `AGENTS_NOTIFICATION_TYPES` (9 templates with Persian copy)
  - `AGENTS_ADMIN_PAGES` (5 entries)
  - `AGENTS_PAYMENT_PURPOSES` (`['agents_purchase', 'agents_run_pack']`)
- `apps/api/src/modules/agents/agents.module.ts` — empty NestJS `@Module({})` for now
- `enabled` flag reads `process.env.ENABLE_AGENTS_MODULE` (default true in dev)

**Notification template specifics** (Persian):

```typescript
AGENTS_LISTING_APPROVED: {
  inApp: { titleFa: 'لیستینگ شما تأیید شد',
           bodyFa: (v) => `لیستینگ "${v.listingTitle}" منتشر شد و در بازارگاه قابل دیدن است.` },
  sms:   (v) => `سازیکو: لیستینگ "${v.listingTitle}" تأیید شد.`
},
AGENTS_LISTING_REJECTED: {
  inApp: { titleFa: 'لیستینگ شما رد شد',
           bodyFa: (v) => `لیستینگ "${v.listingTitle}" تأیید نشد. دلیل: ${v.reason}` },
  sms:   (v) => `سازیکو: لیستینگ شما رد شد. جزئیات در پنل سازنده.`
},
AGENTS_LISTING_SUSPENDED: {
  inApp: { titleFa: 'لیستینگ شما تعلیق شد',
           bodyFa: (v) => `لیستینگ "${v.listingTitle}" موقتاً از بازارگاه حذف شد. دلیل: ${v.reason}` }
},
AGENTS_PURCHASE_RECEIPT: {
  inApp: { titleFa: 'خرید شما ثبت شد',
           bodyFa: (v) => `"${v.listingTitle}" به کتابخانه شما اضافه شد.${v.runs ? ` ${v.runs} اجرا فعال شد.` : ''}` }
},
AGENTS_NEW_SALE: {
  inApp: { titleFa: 'فروش جدید',
           bodyFa: (v) => `یک خریدار جدید لیستینگ "${v.listingTitle}" را خرید.` }
},
AGENTS_RUNS_LOW: {
  inApp: { titleFa: 'اجراهای شما رو به اتمام است',
           bodyFa: (v) => `از "${v.listingTitle}" تنها ${v.remaining} اجرا باقی مانده. برای ادامه، بسته جدید بخرید.` }
},
AGENTS_RUNS_DEPLETED: {
  inApp: { titleFa: 'اجراهای شما تمام شد',
           bodyFa: (v) => `همه اجراهای "${v.listingTitle}" مصرف شد. برای ادامه دسترسی، بسته جدید بخرید.` }
},
AGENTS_REVIEW_POSTED: {
  inApp: { titleFa: 'بازخورد جدید روی لیستینگ شما',
           bodyFa: (v) => `${v.authorName} برای "${v.listingTitle}" امتیاز ${v.rating} از ۵ ثبت کرد.` }
},
AGENTS_NEW_LISTING_PENDING: {
  inApp: { titleFa: 'لیستینگ جدید در صف بررسی',
           bodyFa: (v) => `"${v.listingTitle}" از طرف ${v.makerName} در انتظار بررسی است.` }
}
```

**Acceptance criteria:**

- `pnpm --filter api typecheck` passes
- `pnpm --filter api dev` boots; logs show `[module-loader] registered agents v0.1.0` and `[agents] booted`
- After boot: `Permission` table contains 14 rows with prefix `agents:`
- Notification template registry includes 9 agents types
- Payment purposes allow-list accepts `agents_purchase` and `agents_run_pack`
- Admin pages registry merged result includes 5 agents entries

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 1B.

Create apps/api/src/modules/agents/contract.ts exporting:
- AGENTS_PERMISSIONS: array of PermissionDefinition matching the master
  plan exactly. Each entry has Persian description AND English description.
  defaultRoles populated where appropriate (buyer perms → ['user'], maker
  perms → ['user'], admin perms → ['admin']).
- AGENTS_AUDIT_ACTIONS: const object as in master plan
- AGENTS_NOTIFICATION_TYPES: array of NotificationTypeDefinition with
  Persian templates per the spec in this phase
- AGENTS_ADMIN_PAGES: array per master plan
- AGENTS_PAYMENT_PURPOSES: ['agents_purchase', 'agents_run_pack']

Create apps/api/src/modules/agents/agents.module.ts as empty NestJS
@Module (no controllers/providers yet; those land in Phase 2A onward).

Create apps/api/src/modules/agents/index.ts as the default export per
the plan.

Add to .env.example: ENABLE_AGENTS_MODULE=true

Verify boot logs both registration and onBoot messages.

Verify via psql:
- SELECT code FROM permission WHERE code LIKE 'agents:%' returns 14 rows
- All 14 codes match the spec exactly

Commit as "feat(agents-1B): implement platform module contract".
```

---

## Phase 1C: Settings + Categories Seed + Bootstrap

**Model: 🟢 Sonnet** | ~180 LOC

**Deliverables:**

- `apps/api/src/modules/agents/services/settings.bootstrap.ts`:
  - Implements `OnApplicationBootstrap`
  - Upserts singleton `agents_settings` row (id=1) with defaults from master plan (commission=20, hero copy, all sections enabled)
  - **Idempotent — never overwrites existing values once admin edits**
- Default category seed in `constants.ts` matching the screenshot mockup:
  ```typescript
  export const DEFAULT_CATEGORIES = [
    { slug: 'research', nameFa: 'پژوهش', iconKey: 'flask', colorToken: 'lavender', order: 10 },
    { slug: 'business', nameFa: 'کسب و کار', iconKey: 'briefcase', colorToken: 'mint', order: 20 },
    { slug: 'design', nameFa: 'تصویر و طراحی', iconKey: 'image', colorToken: 'sky', order: 30 },
    { slug: 'voice', nameFa: 'صدا و گفتار', iconKey: 'mic', colorToken: 'rose', order: 40 },
    {
      slug: 'data',
      nameFa: 'تحلیل داده',
      iconKey: 'bar-chart',
      colorToken: 'periwinkle',
      order: 50,
    },
    { slug: 'code', nameFa: 'برنامه‌نویسی', iconKey: 'command', colorToken: 'lemon', order: 60 },
    {
      slug: 'content',
      nameFa: 'نویسندگی و محتوا',
      iconKey: 'pencil',
      colorToken: 'sand',
      order: 70,
    },
  ];
  ```
- `categories.bootstrap.ts` upserts each category — same idempotency pattern (never overwrites admin edits)

**Acceptance:**

- Fresh DB → boot → 1 row in `agents_settings`, 7 rows in `agents_category`
- Admin edits commissionPercent to 25 via `/admin/agents/settings` → restart → still 25
- Disabling a default category via admin → restart → still disabled

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 1C.

Create apps/api/src/modules/agents/constants.ts exporting:
- DEFAULT_CATEGORIES: 7 entries per the plan
- DEFAULT_AGENTS_SETTINGS: object with all default values

Create apps/api/src/modules/agents/services/settings.bootstrap.ts:
- @Injectable() implementing OnApplicationBootstrap
- prisma.agents_settings.upsert({ where: { id: 1 }, create: { id: 1,
  ...DEFAULT_AGENTS_SETTINGS }, update: {} })
- Log "[agents] settings: ensured singleton row"

Create apps/api/src/modules/agents/services/categories.bootstrap.ts:
- For each entry in DEFAULT_CATEGORIES:
  - prisma.agents_category.upsert({ where: { slug }, create: entry,
    update: {} })
- Log "[agents] categories: ensured 7 default categories"

Register both in agents.module.ts providers.

Verify with fresh DB:
- make dev-reset && make dev-up
- pnpm --filter api db:migrate-dev (re-applies)
- pnpm --filter api dev
- make db-shell: 7 categories + 1 settings row

Commit as "feat(agents-1C): seed default settings and categories".
```

---

## Phase 1D: Module Registration in modules.config.ts + Smoke Test

**Model: 🟢 Sonnet** | ~120 LOC

**Deliverables:**

- Update `apps/api/src/modules.config.ts`:

  ```typescript
  import exampleModule from './modules/_example';
  import agentsModule from './modules/agents';

  export const MODULES: PlatformModule[] = [exampleModule, agentsModule];
  ```

- Smoke test `apps/api/test/integration/agents-module-boot.spec.ts` covering: 14 permissions present, settings row + categories seeded, notification types registered, admin pages registry includes 5 agents pages, payment purposes accept agents purposes
- Update `docs/operations.md` with "Agents Marketplace Module" section (disable flag, default commission, where to find admin pages)

**Acceptance:**

- `pnpm --filter api dev` boots cleanly with both modules
- Smoke test passes
- `ENABLE_AGENTS_MODULE=false` → next boot does not load module, routes return 404, but tables + permissions remain

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 1D.

Update apps/api/src/modules.config.ts to import and add agentsModule
to MODULES array, after exampleModule.

Create apps/api/test/integration/agents-module-boot.spec.ts:
- beforeAll: boot full Nest app via Test.createTestingModule
- Test 1: 14 permissions with prefix 'agents:' exist in DB
- Test 2: agents_settings row with id=1 exists with default values
- Test 3: 7 categories seeded
- Test 4: NotificationsService can render AGENTS_PURCHASE_RECEIPT template
- Test 5: PaymentsService.initiate accepts purpose='agents_purchase'
  without throwing INVALID_PURPOSE
- Test 6: admin pages registry returns array including '/admin/agents/listings'

Update docs/operations.md with "Agents Marketplace Module" section.

Verify: pnpm --filter api dev + pnpm --filter api test pass.

Commit as "feat(agents-1D): register agents module + smoke test".
```

---

## Phase 1E: FTS Trigger + Trigram Indexes

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** Search is a foundational capability. Wrong indexing strategy means rebuilding search later.

**Deliverables:**

- New migration `agents_search_indexes`:
  - Enable `pg_trgm` extension if not enabled
  - Create function `agents_listing_search_vector_update()` that builds tsvector from `setweight('A', titleFa) || setweight('B', shortDescFa) || setweight('C', longDescFaMd)` (using `simple` regconfig — Persian doesn't have a Postgres FTS dictionary, so weight-based ranking on raw lexemes is the right approach)
  - Trigger BEFORE INSERT OR UPDATE on `agents_listing` to auto-update `searchVector`
  - GIN index on `searchVector`
  - Trigram GIN indexes on `titleFa`, `slug`, `shortDescFa` for ILIKE substring fallback
- Backfill existing rows (in this phase: zero rows yet)
- Verification SQL queries documented in CLAUDE.md

**Acceptance:**

- `INSERT INTO agents_listing` automatically populates `searchVector`
- `UPDATE agents_listing SET titleFa = ...` updates `searchVector`
- `SELECT * FROM agents_listing WHERE searchVector @@ plainto_tsquery('simple', 'فارسی')` returns matches
- ILIKE on `titleFa` uses trigram index (verifiable via `EXPLAIN`)

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 1E.

Create migration agents_search_indexes via prisma migrate dev
--create-only --name agents_search_indexes. Hand-write the SQL:

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION agents_listing_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('simple', COALESCE(NEW."titleFa", '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW."shortDescFa", '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(LEFT(NEW."longDescFaMd", 4000), '')), 'C') ||
    setweight(to_tsvector('simple', COALESCE(NEW."slug", '')), 'A');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agents_listing_tsv_update
BEFORE INSERT OR UPDATE OF "titleFa", "shortDescFa", "longDescFaMd", "slug"
ON agents_listing
FOR EACH ROW EXECUTE FUNCTION agents_listing_search_vector_update();

CREATE INDEX agents_listing_search_vector_idx ON agents_listing
USING GIN ("searchVector");

CREATE INDEX agents_listing_title_trgm_idx ON agents_listing
USING GIN ("titleFa" gin_trgm_ops);

CREATE INDEX agents_listing_slug_trgm_idx ON agents_listing
USING GIN ("slug" gin_trgm_ops);

CREATE INDEX agents_listing_shortdesc_trgm_idx ON agents_listing
USING GIN ("shortDescFa" gin_trgm_ops);

Apply migration. Verify by inserting a test row via psql, confirming
searchVector is populated, then running:
SELECT id, ts_rank("searchVector", plainto_tsquery('simple', 'test'))
FROM agents_listing
WHERE "searchVector" @@ plainto_tsquery('simple', 'test');

Document verification queries in apps/api/src/modules/agents/CLAUDE.md.

Commit as "feat(agents-1E): add full-text search and trigram indexes".
```

---

## Phase 1F: Polymorphic Cart Shape

**Model: 🟢 Sonnet** | ~150 LOC

**Why this phase exists:** The cart will eventually serve multiple modules (agents, templates). Designing the cart shape now prevents schema rework later.

**Deliverables:**

- Update `agents_cart_item` schema (via migration): rename to keep agents-specific OR introduce sibling design
- **Decision:** keep `agents_cart_item` as agents-specific table (no shared cart table). Future modules (templates) will get their own `templates_cart_item`. The cart UI page renders ALL module cart tables aggregated. This avoids polymorphic FK complexity in Postgres.
- Define `CartLineDescriptor` interface in `apps/api/src/core/cart/cart.types.ts` (system-level addition; small):
  ```typescript
  export interface CartLineDescriptor {
    moduleSource: string; // 'agents'
    moduleItemId: string; // bigint as string
    titleFa: string;
    pricingType: string;
    priceToman: bigint;
    quantity: number; // always 1 in MVP
    metadata?: Record<string, unknown>; // module-specific (run pack info, etc.)
  }
  ```
- `CartAggregatorService` in `apps/api/src/core/cart/cart-aggregator.service.ts` — system-level, modules register their cart adapter
- Agents module's cart adapter: `apps/api/src/modules/agents/services/cart-adapter.service.ts` — implements adapter interface, queries `agents_cart_item` and returns `CartLineDescriptor[]`

**Acceptance:**

- System cart aggregator exists with adapter registration pattern
- Agents module registers its adapter on boot
- `cartAggregator.getForUser(userId)` returns array of `CartLineDescriptor` from agents adapter

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 1F.

This phase introduces a small SYSTEM-LEVEL addition: the cart aggregator
that modules feed into.

Create apps/api/src/core/cart/:
- cart.module.ts: provides CartAggregatorService globally
- cart.types.ts: exports CartLineDescriptor interface and CartAdapter interface
  CartAdapter:
    interface CartAdapter {
      moduleSource: string;
      getForUser(userId: bigint): Promise<CartLineDescriptor[]>;
      removeItem(userId: bigint, moduleItemId: string): Promise<void>;
      clearForUser(userId: bigint): Promise<void>;
    }
- cart-aggregator.service.ts:
  - registerAdapter(adapter: CartAdapter)
  - getForUser(userId): aggregates across all registered adapters
  - removeItem(userId, moduleSource, moduleItemId): routes to correct adapter
  - clearForUser(userId): clears across all adapters

Register CartModule in app.module.ts globally.

Now in apps/api/src/modules/agents/services/cart-adapter.service.ts:
- @Injectable() implementing CartAdapter
- moduleSource = 'agents'
- getForUser: query agents_cart_item joined with agents_listing and
  agents_run_pack, return CartLineDescriptor[] with metadata
  { listingId, runPackId, pricingType }
- removeItem: delete from agents_cart_item by composite key
- clearForUser: delete all agents_cart_item where userId

In agents.module.ts:
- Inject CartAggregatorService
- onBoot: cartAggregator.registerAdapter(agentsCartAdapter)
  (Use OnApplicationBootstrap or the module contract's onBoot — confirm
  registration timing with module-registry's onBoot semantics from
  system Phase 11A.)

Add unit test for cart aggregator with a mock adapter.

Commit as "feat(agents-1F): cart aggregator + agents adapter".
```

---

## Test Gate 1: Module Foundation Verification

**Model: 🔴 Opus**

- [ ] All `agents_*` tables created with correct columns and FKs
- [ ] Append-only trigger blocks UPDATE/DELETE on `agents_run_event`
- [ ] `agents_purchase` allows status updates (refund support)
- [ ] Module registers at boot, log confirms
- [ ] 14 permissions in `Permission` table with `agents:` prefix
- [ ] 7 default categories seeded
- [ ] 1 row in `agents_settings` with default values
- [ ] All 9 notification templates registered
- [ ] Payment purposes allow-list includes `agents_purchase`, `agents_run_pack`
- [ ] Admin pages registry includes 5 agents pages
- [ ] FTS trigger populates `searchVector` on insert/update
- [ ] Trigram indexes verifiable via EXPLAIN
- [ ] Cart aggregator service exists and accepts adapter registration
- [ ] Agents cart adapter registered on boot
- [ ] Disabling module via env flag → routes 404, data preserved
- [ ] Smoke test passes

---

# Phase Group 2 — Public Marketplace

## Phase 2A: ListingsService Core

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Core service with status state-machine; bugs ripple through every other listing-related phase.

**Deliverables:**

- `apps/api/src/modules/agents/services/listings.service.ts`:
  - `findPublishedById(id)` / `findPublishedBySlug(slug)` — only PUBLISHED + not deleted; cache hit
  - `findByIdForMaker(id, makerUserId)` — any status; ownership check
  - `findByIdForAdmin(id)` — any status; admin context
  - `create({ makerUserId, dto })` — initial status DRAFT (admin sets to PENDING_REVIEW when maker submits)
  - `submitForReview(id, makerUserId)` — DRAFT → PENDING_REVIEW; dispatches `AGENTS_NEW_LISTING_PENDING` to admins
  - `approve(id, adminUserId)` — PENDING_REVIEW → PUBLISHED, sets `publishedAt`
  - `reject(id, adminUserId, reason)` — PENDING_REVIEW → REJECTED with reason
  - `suspend(id, adminUserId, reason)` — PUBLISHED → SUSPENDED with reason
  - `unsuspend(id, adminUserId)` — SUSPENDED → PUBLISHED
  - `incrementUserCount(listingId)` — denormalized counter on purchase
  - `incrementRunCount(listingId)` — denormalized counter on run consumption
  - `recomputeRating(listingId)` — recalc avg/count from `agents_review`
  - `softDelete(id)` — admin-only; sets `deletedAt`
- All status transitions guarded; invalid transition → throw `INVALID_STATUS_TRANSITION`
- Each transition writes to system audit log via `@Audit({ action: ... })` decorator at controller layer (or direct service call where no controller context)
- Each transition dispatches appropriate notification

**Acceptance:**

- Cannot approve a DRAFT listing (must transition through PENDING_REVIEW)
- Cannot suspend a REJECTED listing
- Concurrent transitions serialize via row lock
- Notifications dispatched on each transition

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 2A.

Build apps/api/src/modules/agents/services/listings.service.ts implementing
the methods listed in the plan.

Status transition matrix (enforce strictly):
  DRAFT → PENDING_REVIEW (via submitForReview)
  PENDING_REVIEW → PUBLISHED (via approve)
  PENDING_REVIEW → REJECTED (via reject)
  PUBLISHED → SUSPENDED (via suspend)
  SUSPENDED → PUBLISHED (via unsuspend)
  PUBLISHED → PENDING_REVIEW (when maker edits — handled in Phase 4B)

Anything else throws INVALID_STATUS_TRANSITION.

Each write method uses prisma.$transaction with row lock (SELECT ...
FOR UPDATE on the listing) to prevent concurrent transition races.

Notifications dispatched within the transaction (notification creation
is a DB row in same transaction; SMS/email firing happens after commit
via OutboxPattern — but for MVP, just call notificationsService directly
inside the transaction; SMS provider call happens post-commit via NestJS
event pattern).

Add error codes: INVALID_STATUS_TRANSITION, LISTING_NOT_FOUND.

Unit tests cover every valid and invalid transition.

Commit as "feat(agents-2A): listings service with status state machine".
```

---

## Phase 2B: Catalog Endpoint with Filters + Cursor Pagination

**Model: 🟢 Sonnet** | ~200 LOC

**Deliverables:**

- `apps/api/src/modules/agents/controllers/catalog.controller.ts`
- `GET /api/v1/agents/catalog`:
  - Query params (Zod validated):
    - `categoryId?` (BigInt)
    - `pricingType?` (`FREE` | `ONE_TIME` | `PER_RUN`)
    - `freeOnly?` (boolean)
    - `minRating?` (1-5)
    - `cursor?` (BigInt, pagination)
    - `limit?` (default 20, max 50)
    - `sort?` (`newest` | `most-installed` | `top-rated`, default `most-installed`)
  - Returns `{ data: ListingCardDto[], meta: { nextCursor, hasMore } }`
  - `ListingCardDto` is the shape used by listing cards: `id, slug, titleFa, shortDescFa, categoryId, categoryNameFa, makerHandle, pricingType, oneTimePriceToman, ratingAverage, ratingCount, totalUsers, totalRuns, primaryScreenshotUrl, isFeatured`
  - Status filter is implicit: only `PUBLISHED` rows included
- `@Public()` decorator (catalog is browsable without login)

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 2B.

Create apps/api/src/modules/agents/controllers/catalog.controller.ts
with @Get('catalog') @Public().

Zod query schema per the plan.

Add to ListingsService:
- findPublished({ filters, cursor, limit, sort }):
  Build dynamic Prisma query with:
  - status: PUBLISHED
  - deletedAt: null
  - filter clauses based on input
  - orderBy based on sort param
  - cursor pagination (id < cursor for next page)
  - take: limit + 1 (peek for hasMore)
  Returns { items, nextCursor, hasMore }

Add ListingCardDto with the fields listed in the plan. Build a mapper
function listingToCardDto(listing) that includes joined category name
and maker handle (handle = first 8 chars of phone after the +98, masked,
or future user.handle field).

For maker handle in v1: use a deterministic short code from userId (e.g.,
'm' + base62(userId)). Real maker handles are a v1.5 feature.

Integration test: insert 30 published listings via Prisma, hit catalog
endpoint with various filters, assert pagination + filter correctness.

Commit as "feat(agents-2B): catalog endpoint with filters and pagination".
```

---

## Phase 2C: Listing Detail Endpoint

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Detail page is the conversion surface. Must include everything needed to render the page in one round-trip.

**Deliverables:**

- `GET /api/v1/agents/listings/:slug` — single listing detail with all related data:
  - Full listing fields
  - All screenshots (ordered)
  - All active run packs (if PER_RUN)
  - First page of reviews (10) + total review count + rating distribution
  - Maker info (handle, total listings count, joined date)
  - Whether current user (if authenticated) already owns this listing
  - Whether current user has runs remaining (if PER_RUN)
- Returns 404 if status not PUBLISHED (admins use the admin endpoint to view non-published)
- `@Public()` — anonymous browsing allowed; ownership check skipped if no JWT

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 2C.

Add to ListingsService:
- findDetailBySlug(slug, currentUserId?: bigint): comprehensive query
  with all joins. Use Prisma include with screenshots, runPacks (where
  isActive: true, orderBy: order asc), reviews (top 10 by createdAt
  desc, where !isHidden), maker (just userId for now).

Build helper computeOwnership(listingId, userId): returns
{ owns: bool, runsRemaining: number | null }
- owns: any non-refunded purchase exists
- runsRemaining: only meaningful for PER_RUN; agents_user_runs.remainingRuns

Build helper computeRatingDistribution(listingId): returns
{ '1': count, '2': count, ..., '5': count }

Build ListingDetailDto with all fields described.

Add to controller:
- @Get('listings/:slug') @Public()
  - currentUserId from optional JWT (don't enforce auth)
  - Return ListingDetailDto

Integration test: published listing → 200 with all sections; non-published
→ 404; ownership flag correct for buyer vs non-buyer.

Commit as "feat(agents-2C): listing detail endpoint".
```

---

## Phase 2D: Featured / Best-Sellers / New Releases / Recent Activity

**Model: 🟢 Sonnet** | ~180 LOC

**Deliverables:**

- `GET /agents/featured` — `agents_listing` where `isFeatured = true && status = PUBLISHED`, ordered by `featuredOrder ASC`, limit from settings (`featuredItemCount`)
- `GET /agents/best-sellers` — top by `totalUsers DESC`, limit from settings (`bestSellersItemCount`), only PUBLISHED
- `GET /agents/new-releases` — order by `publishedAt DESC`, limit from settings (`newReleasesItemCount`), only PUBLISHED
- `GET /agents/recent-activity` — last 50 anonymized purchase events for the homepage feed widget:
  - Format: `{ kind: 'install' | 'purchase' | 'review', userHandle: 'm.{shortid}', listingSlug, listingTitleFa, timestamp }`
  - "Install" for FREE, "purchase" for paid, "review" for review postings
  - Persian timestamps formatted relative ("۲ دقیقه پیش")
- All endpoints `@Public()` and aggressively cached (60s Redis TTL)

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 2D.

Add to ListingsService:
- findFeatured(): per the plan
- findBestSellers(): per the plan
- findNewReleases(): per the plan
- findRecentActivity(): merges last 50 purchase + review events into
  one timeline. Use UNION query for efficiency, with type discriminator.

All four methods cache results in Redis with key
"agents:section:{name}" and 60s TTL. Cache invalidates on any listing
status change or purchase event (use event listeners or call
explicitly from listings/purchases services).

Add controller endpoints for all four.

Integration tests cover each endpoint shape and cache behavior.

Commit as "feat(agents-2D): featured/best-sellers/new-releases/recent-activity
endpoints with caching".
```

---

## Phase 2E: Public Categories Endpoint

**Model: 🟢 Sonnet** | ~130 LOC

**Deliverables:**

- `GET /agents/categories` — list active categories with denormalized count of published listings per category
- `@Public()`, cached 5 minutes
- Returns `{ data: [{ id, slug, nameFa, iconKey, colorToken, listingCount }] }`

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 2E.

Add CategoriesService at apps/api/src/modules/agents/services/categories.service.ts:
- findAllPublic(): returns active categories with listing counts.
  Single SQL with LEFT JOIN aggregation:
    SELECT c.*, COUNT(l.id) FILTER (WHERE l.status = 'PUBLISHED' AND
    l."deletedAt" IS NULL) as listing_count
    FROM agents_category c
    LEFT JOIN agents_listing l ON l."categoryId" = c.id
    WHERE c."isActive" = true
    GROUP BY c.id
    ORDER BY c."order" ASC

Cache result in Redis "agents:categories:public" 5min TTL.

Build CategoriesController with @Get('categories') @Public().

Integration test verifies counts update correctly when listings change status.

Commit as "feat(agents-2E): public categories endpoint with counts".
```

---

## Phase 2F: Search Endpoint

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Search ranking has subtle issues. Persian query handling needs care.

**Deliverables:**

- `GET /agents/search`:
  - Query params: `q` (required, min 2 chars), category, pricingType, freeOnly, minRating, cursor, limit
  - Strategy:
    1. If `q` is non-empty: use `tsvector @@ plainto_tsquery('simple', q)` ranked by `ts_rank` + apply other filters
    2. If FTS returns < 10 results, fall back to ILIKE on titleFa/slug (trigram index makes this fast)
  - Returns same `ListingCardDto[]` as catalog
  - `@Public()`

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 2F.

Add to ListingsService:
- searchPublished({ q, filters, cursor, limit }):
  Use prisma.$queryRaw to leverage tsvector + ts_rank. Persian query
  is passed through plainto_tsquery('simple', $1).
  ORDER BY ts_rank(searchVector, query) DESC, totalUsers DESC.
  Apply filters as additional WHERE clauses.
  If fewer than 10 results returned, augment with ILIKE fallback:
  WHERE titleFa ILIKE '%' || $1 || '%' OR slug ILIKE ... — dedupe
  by id, append at end.

Helper: sanitize q (strip null bytes, limit length to 200 chars,
collapse whitespace).

Add controller endpoint @Get('search') @Public().

Add @RateLimit({ ip: '60/min' }) to prevent search abuse.

Integration tests:
- Persian query "فارسی" matches listing with "فارسی" in titleFa
- Empty q returns 400 VALIDATION_ERROR
- Combined filter (q + category) works
- ILIKE fallback when FTS misses

Commit as "feat(agents-2F): search endpoint with FTS and trigram fallback".
```

---

## Phase 2G: View Tracking

**Model: 🟢 Sonnet** | ~130 LOC

**Why this is needed:** Best-sellers ranking can use install counts; "trending" rankings (future) need view counts. Cheap to add now.

**Deliverables:**

- `agents_listing.viewCount` BIGINT default 0 (add via migration)
- Endpoint: `POST /agents/listings/:slug/view` — fire-and-forget increment, sampled (1 in 5 to reduce DB writes)
- Frontend calls this from listing detail page on mount

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 2G.

Add migration agents_listing_view_count:
ALTER TABLE agents_listing ADD COLUMN "viewCount" BIGINT NOT NULL DEFAULT 0;

Add to ListingsService:
- recordView(slug): atomic UPDATE incrementing viewCount, with 1-in-5
  sampling (caller passes a random number; service only acts if number
  < 0.2). This is approximate — exact analytics is overkill for v1.

Add @Post('listings/:slug/view') @Public() to controller. Body is empty.
Returns 204.

@RateLimit({ ip: '120/min' }) to prevent ddos-style view inflation.

Commit as "feat(agents-2G): listing view tracking with sampling".
```

---

## Test Gate 2: Public Marketplace Verification

**Model: 🔴 Opus**

- [ ] `GET /catalog` returns paginated published listings
- [ ] All filters work (category, pricingType, freeOnly, minRating)
- [ ] Cursor pagination works correctly
- [ ] `GET /listings/:slug` returns full detail with screenshots, packs, reviews
- [ ] Non-published slug → 404
- [ ] `GET /featured`, `/best-sellers`, `/new-releases` return correct data
- [ ] `/recent-activity` shows mixed purchase + review events
- [ ] `/categories` returns counts that update correctly
- [ ] Search with Persian query works
- [ ] Search with no results returns empty array, not error
- [ ] View tracking increments counter
- [ ] Cache TTL behavior verified (60s for sections, 5min for categories)

---

# Phase Group 3 — Cart, Checkout, Library

## Phase 3A: CartService + Guest Cart Merge

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Hybrid cart with guest-merge logic has many edge cases.

**Deliverables:**

- `CartService` in `apps/api/src/modules/agents/services/cart.service.ts`:
  - `addItem(userId, { listingId, runPackId? })` — validates listing PUBLISHED, validates pack belongs to listing if PER_RUN, prevents duplicates
  - `removeItem(userId, cartItemId)` — ownership-checked
  - `clearForUser(userId)`
  - `mergeGuestCart(userId, items: { listingId, runPackId? }[])` — for hybrid cart: called on login with localStorage payload; deduplicates against existing DB cart, validates each item still purchasable
- Add `POST /api/v1/agents/cart` (add), `DELETE /cart/:cartItemId`, `POST /cart/merge`, `GET /cart` endpoints
- Validation rules:
  - Listing must exist + PUBLISHED + not soft-deleted
  - For PER_RUN: `runPackId` required + pack must be active + belong to listing
  - User cannot add their own listing to cart (maker can't buy own agent)
  - User who already owns a non-PER_RUN listing cannot add it again
  - For PER_RUN: re-adding is allowed (each cart line is a fresh pack purchase)

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 3A.

Build apps/api/src/modules/agents/services/cart.service.ts implementing
the methods per the plan.

Validation in addItem:
1. Listing exists, status = PUBLISHED, deletedAt = null
2. If listing.pricingType = PER_RUN: runPackId required;
   pack.listingId = listing.id; pack.isActive = true
3. listing.makerUserId !== userId (cannot buy own listing) →
   throw CANNOT_BUY_OWN_LISTING
4. If pricingType !== PER_RUN: check no existing COMPLETED purchase →
   throw ALREADY_OWNED
5. Use prisma.upsert with the unique constraint to handle duplicates

mergeGuestCart logic:
- Input: array of { listingId, runPackId? }
- For each item: try addItem; collect successes and failures
- Return { merged: number, failed: { listingId, reason }[] }
- Failures (e.g., listing now PENDING_REVIEW) are surfaced to user

Add controller AgentsCartController with the 4 endpoints. All except
GET require @Idempotent() since cart mutations should be safe to retry.

Add error codes: CANNOT_BUY_OWN_LISTING, ALREADY_OWNED,
LISTING_NOT_PURCHASABLE, INVALID_RUN_PACK.

Integration test: full hybrid scenario
- Anonymous user (frontend test): localStorage cart with 3 items
- Login → call merge endpoint with payload
- Verify all 3 items merged; ownership/duplicates filtered correctly

Commit as "feat(agents-3A): cart service with guest merge".
```

---

## Phase 3B: Checkout Endpoint (No Real Payment)

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Checkout creates ownership records; idempotency and atomicity are critical even without real payment.

**Deliverables:**

- `POST /api/v1/agents/checkout`:
  - JWT required
  - Body: empty (uses current user's cart contents)
  - `@Idempotent()` mandatory
  - Flow:
    1. Lock all cart rows for current user (`SELECT ... FOR UPDATE`)
    2. Re-validate each item (listing still PUBLISHED, packs still active)
    3. Compute totals + commission per item using `agents_settings.commissionPercent`
    4. **Create `agents_purchase` rows** with `status = COMPLETED`, `systemPaymentId = null` (no real payment yet)
    5. For PER_RUN items: upsert `agents_user_runs` with `remainingRuns += pack.runs`, `totalGranted += pack.runs`
    6. Increment `agents_listing.totalUsers` (only if first purchase by this user for this listing)
    7. Clear cart
    8. Dispatch `AGENTS_PURCHASE_RECEIPT` to buyer + `AGENTS_NEW_SALE` to each maker
    9. Return `{ purchaseIds: [...], totalAmountToman, summary }`
  - All in single Prisma `$transaction`
- Empty cart → 400 `EMPTY_CART`

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 3B.

Build apps/api/src/modules/agents/services/checkout.service.ts:
- checkout(userId): implements the flow per the plan

Detailed logic:
1. prisma.$transaction with isolation level Serializable
2. Lock cart rows: prisma.$queryRaw`SELECT * FROM agents_cart_item
   WHERE "userId" = ${userId} FOR UPDATE`
3. If empty → throw EMPTY_CART
4. Read settings.commissionPercent (default 20)
5. For each cart item:
   - Re-fetch listing; if not PUBLISHED or deleted → skip + add to
     errors array
   - Compute amount: FREE=0, ONE_TIME=listing.oneTimePriceToman,
     PER_RUN=pack.priceToman
   - Compute commission = floor(amount * commissionPercent / 100)
   - Compute makerEarned = amount - commission
   - INSERT agents_purchase row with all fields
   - If PER_RUN: prisma.agents_user_runs.upsert({
       where: { userId_listingId: { userId, listingId } },
       create: { userId, listingId, remainingRuns: pack.runs,
                totalGranted: pack.runs },
       update: { remainingRuns: { increment: pack.runs },
                 totalGranted: { increment: pack.runs } },
     })
   - If first-time buyer: increment listing.totalUsers (atomic)
6. DELETE FROM agents_cart_item WHERE userId = $1
7. Dispatch notifications (in transaction, fire SMS/email post-commit)
8. Return summary

If any item fails validation, the transaction rolls back the entire
checkout. The frontend must show which items failed and let the user
fix and retry.

Add @Post('checkout') controller endpoint marked @Idempotent().

Add error codes: EMPTY_CART, CHECKOUT_VALIDATION_FAILED.

Integration tests:
- All 3 pricing types (FREE, ONE_TIME, PER_RUN) checkout correctly
- Concurrent checkouts on same user serialize (no double-grant)
- Listing suspension between cart-add and checkout → item skipped,
  user notified
- Empty cart → 400

Commit as "feat(agents-3B): checkout endpoint (no real payment yet)".
```

---

## Phase 3C: Library Endpoints

**Model: 🟢 Sonnet** | ~180 LOC

**Deliverables:**

- `GET /api/v1/agents/me/library`:
  - JWT required
  - Returns user's owned listings: `[{ purchaseId, listingId, listingSlug, listingTitleFa, primaryScreenshotUrl, pricingType, ownedSince, runsRemaining (null if not PER_RUN), totalRuns (lifetime granted), latestPurchaseDate }]`
  - Aggregated: one row per listing even if multiple PER_RUN packs purchased
- `GET /api/v1/agents/me/library/:listingId`:
  - Detail: full listing fields + ownership history (all packs purchased) + remaining runs

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 3C.

Build LibraryService:
- findForUser(userId): aggregated query
  SELECT
    listing.id as listingId, listing.slug, listing.titleFa,
    listing.pricingType,
    MIN(purchase.createdAt) as ownedSince,
    MAX(purchase.createdAt) as latestPurchaseDate,
    COALESCE(runs.remainingRuns, NULL) as runsRemaining,
    COALESCE(runs.totalGranted, 0) as totalRuns
  FROM agents_purchase purchase
  JOIN agents_listing listing ON listing.id = purchase.listingId
  LEFT JOIN agents_user_runs runs ON runs.userId = purchase.userId
    AND runs.listingId = purchase.listingId
  WHERE purchase.userId = $1 AND purchase.status = 'COMPLETED'
  GROUP BY listing.id, runs.remainingRuns, runs.totalGranted
  ORDER BY latestPurchaseDate DESC

- findDetailForUser(userId, listingId): includes purchase history

Add LibraryController:
- @Get('me/library') @RequirePermission('agents:read:catalog')
- @Get('me/library/:listingId') @RequirePermission('agents:read:catalog')

Sanitization: don't expose makerEarned or commission to buyer.

Integration tests:
- After buying ONE_TIME: library shows 1 row
- After buying 2 PER_RUN packs: library shows 1 row, runsRemaining is sum
- After buying 3 different listings: 3 rows

Commit as "feat(agents-3C): library endpoints".
```

---

## Phase 3D: Download Owned Bundle

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** Download endpoint requires precise ownership check + secure file streaming.

**Deliverables:**

- `GET /api/v1/agents/me/library/:listingId/download`:
  - JWT required
  - Validates ownership (any non-refunded `agents_purchase` row exists for `(userId, listingId)`)
  - Streams `agents_listing.bundleFileId` via system FileStore
  - Sets `Content-Disposition: attachment; filename="{listing-slug}.zip"`
  - Audit: `AGENTS_BUNDLE_DOWNLOADED` action (add to catalog)
  - Rate limit: 30/min/user (downloads should be infrequent)

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 3D.

Add to AGENTS_AUDIT_ACTIONS catalog: AGENTS_BUNDLE_DOWNLOADED.

Build DownloadService:
- streamBundleForOwner(userId, listingId):
  1. Query: any agents_purchase WHERE userId AND listingId AND
     status = COMPLETED → if none, throw FORBIDDEN with ACCESS_DENIED_NOT_OWNER
  2. Fetch listing.bundleFileId; if null → throw NOT_FOUND with
     BUNDLE_NOT_AVAILABLE
  3. Use system FilesService.streamForDownload(bundleFileId, userId,
     hasAdminAccess=true) — bypass owner check at file level since we
     already validated ownership of the listing
  4. Return stream + content-type + filename hint

Add controller endpoint @Get('me/library/:listingId/download')
@Audit({ action: 'AGENTS_BUNDLE_DOWNLOADED', resource: 'agent_listing',
resourceIdParam: 'listingId' })

Apply custom rate limit: 30/min/user.

Integration test:
- Owner downloads → 200 with correct bytes
- Non-owner → 403 ACCESS_DENIED_NOT_OWNER
- Listing without bundleFileId → 404 BUNDLE_NOT_AVAILABLE
- Refunded user can no longer download

Commit as "feat(agents-3D): owned-bundle download endpoint".
```

---

## Phase 3E: Run Consumption Endpoint

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Single most security-critical surface in this module. Bug = stolen runs or duplicated decrements.

**Deliverables:**

- `POST /api/v1/agents/runs/consume`:
  - **Auth: API key in `X-Agent-API-Key` header** (NOT JWT)
  - Body: `{ listingSlug, userId }`
  - `@Public()` (no JWT) but rate-limited 1000/min/IP
  - Atomic decrement via Postgres `UPDATE ... SET remainingRuns = remainingRuns - 1 WHERE remainingRuns > 0 RETURNING remainingRuns`
  - Returns `{ remainingRuns, totalConsumed }` on success
  - 401 `INVALID_API_KEY` on key mismatch
  - 409 `INSUFFICIENT_RUNS` if no balance
  - Audit: every attempt logged in `agents_run_event` (success or failure)
  - Notifications: `AGENTS_RUNS_LOW` at ≤10% threshold (once); `AGENTS_RUNS_DEPLETED` at 0
  - Increments `agents_listing.totalRuns` denormalized counter

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 3E.

Build RunsService:
- consume({ listingSlug, userId, apiKeyPlaintext, ipAddress, userAgent }):
  1. Look up listing by slug; if not PUBLISHED → return REFUSED_INVALID_KEY
     (don't leak whether listing exists)
  2. Compute apiKeyHash = sha256(apiKeyPlaintext); compare to
     listing.apiKeyHash; on mismatch → insert agents_run_event with
     outcome=REFUSED_INVALID_KEY, return 401 INVALID_API_KEY
  3. Atomic decrement (single SQL):
     UPDATE agents_user_runs
     SET remainingRuns = remainingRuns - 1,
         totalConsumed = totalConsumed + 1,
         lastConsumedAt = NOW()
     WHERE userId = $1 AND listingId = $2 AND remainingRuns > 0
     RETURNING remainingRuns, totalConsumed
  4. If no row updated → insert agents_run_event with outcome=
     REFUSED_INSUFFICIENT, return 409 INSUFFICIENT_RUNS
  5. Insert agents_run_event with outcome=CONSUMED
  6. UPDATE agents_listing SET totalRuns = totalRuns + 1 WHERE id = $listingId
  7. Check threshold: if remainingRuns <= ceil(0.1 * lastPackSize) and
     not yet notified, dispatch AGENTS_RUNS_LOW
  8. If remainingRuns = 0, dispatch AGENTS_RUNS_DEPLETED
  9. Return { remainingRuns, totalConsumed }

Build RunsController:
- @Post('runs/consume') @Public()
  Reads X-Agent-API-Key header; validates Zod body { listingSlug,
  userId: bigint }
  Custom rate limit: 1000/min/IP

Build a "low-runs notification dedup" pattern: store
"agents:lowruns:{userId}:{listingId}" in Redis with 24h TTL after firing
once; resets after a new pack purchase clears the threshold.

Add error codes: INVALID_API_KEY, INSUFFICIENT_RUNS.

Integration tests:
- Valid key + sufficient runs → 200 with decrement
- Invalid key → 401 + REFUSED_INVALID_KEY event
- Zero runs → 409 + REFUSED_INSUFFICIENT event
- Concurrent consume calls serialize correctly (no double-decrement)
- Threshold notifications fire once per pack

Commit as "feat(agents-3E): run consumption endpoint with API-key auth".
```

---

## Phase 3F: Reviews

**Model: 🟢 Sonnet** | ~180 LOC

**Deliverables:**

- `POST /api/v1/agents/me/library/:listingId/review` — JWT, ownership-checked, max 1 per (user, listing); body `{ rating: 1-5, bodyFa? }`
- `PATCH /api/v1/agents/me/library/:listingId/review` — edit own review
- `DELETE /api/v1/agents/me/library/:listingId/review` — delete own review
- After mutation: recompute `agents_listing.ratingAverage` and `ratingCount` (denormalized)
- Dispatch `AGENTS_REVIEW_POSTED` to maker on first review by this user
- Admin endpoint `POST /admin/agents/reviews/:id/hide` (built in Phase 5C)

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 3F.

Build ReviewsService:
- post({ userId, listingId, rating, bodyFa }):
  1. Validate ownership (purchase exists, COMPLETED)
  2. Validate rating 1-5
  3. INSERT (or upsert via unique constraint listingId + authorUserId)
  4. recomputeRating(listingId): UPDATE listing SET ratingAverage =
     AVG(rating), ratingCount = COUNT(*) FROM reviews WHERE listingId
     AND !isHidden
  5. Dispatch AGENTS_REVIEW_POSTED to maker

- update({ userId, listingId, ... })
- delete({ userId, listingId })

Build ReviewsController endpoints per the plan. All audited.

Integration tests: full review lifecycle including rating recomputation.

Commit as "feat(agents-3F): reviews endpoints".
```

---

## Test Gate 3: Cart, Checkout, Library Verification

**Model: 🔴 Opus**

- [ ] Add to cart works for FREE, ONE_TIME, PER_RUN
- [ ] Cannot add own listing
- [ ] Cannot add already-owned non-PER_RUN listing
- [ ] Guest cart merge on login works
- [ ] Checkout creates correct purchase records
- [ ] PER_RUN purchases stack runs (cumulative — locked decision 7)
- [ ] Library shows aggregated ownership
- [ ] Download works for owners; blocks non-owners
- [ ] Run consumption with valid key decrements; with invalid → 401
- [ ] Insufficient runs → 409
- [ ] Concurrent run consumes serialize
- [ ] Low-run threshold notification fires once per pack
- [ ] Reviews enforce one-per-listing-per-user
- [ ] Rating recomputation accurate
- [ ] All actions in audit log

---

# Phase Group 4 — Maker Operations

## Phase 4A: Listing Submission

**Model: 🔴 Opus** | ~200 LOC

**Deliverables:**

- `POST /api/v1/agents/me/maker/listings`:
  - JWT, `agents:create:listing` permission
  - Body (Zod):
    ```typescript
    {
      slug: string,                  // unique, lowercase-kebab, auto-validated
      titleFa: string,               // 5-200 chars
      shortDescFa: string,           // 20-300 chars
      longDescFaMd: string,          // 100-20000 chars markdown
      installInstructionsFaMd?: string,
      categoryId: bigint,
      pricingType: AgentsPricingType,
      oneTimePriceToman?: bigint,    // required if ONE_TIME
      runPacks?: Array<{ nameFa, runs, priceToman }>,  // required if PER_RUN, 1-5 packs
      bundleFileId?: bigint,         // optional at submission, can attach later
    }
    ```
  - Creates listing as `DRAFT` initially
  - Validation:
    - Slug unique across all listings (including soft-deleted?)
    - Pricing fields match pricingType
    - For PER_RUN: 1-5 packs, all with runs > 0 and priceToman > 0
    - Maker has not exceeded listing quota (default 50 active listings, configurable in settings)
  - Frontend may upload screenshots and bundle separately via Phase 4D + system file upload

- `POST /api/v1/agents/me/maker/listings/:id/submit-for-review`:
  - DRAFT → PENDING_REVIEW
  - Re-validates all fields are complete
  - Dispatches `AGENTS_NEW_LISTING_PENDING` to admins

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 4A.

Add to ListingsService:
- create({ makerUserId, dto }): validates and creates DRAFT listing.
  Slug uniqueness check (case-insensitive). Build run packs in same
  transaction.
- submitForReview(id, makerUserId): re-validates, transitions DRAFT
  → PENDING_REVIEW, dispatches AGENTS_NEW_LISTING_PENDING.

Build MakerListingsController:
- @Post('me/maker/listings') @RequirePermission('agents:create:listing')
  @Idempotent()
- @Post('me/maker/listings/:id/submit-for-review')

Zod DTO with comprehensive validation:
- slug: regex /^[a-z0-9](-?[a-z0-9])*$/, length 3-120
- titleFa: 5-200 chars, no scripts (Persian unicode + spaces)
- shortDescFa: 20-300 chars
- longDescFaMd: 100-20000 chars
- pricingType matches one of enum
- if PER_RUN: runPacks.length 1-5, each pack { runs > 0, priceToman > 0 }
- if ONE_TIME: oneTimePriceToman > 0

Add error codes: SLUG_TAKEN, INVALID_PACKS, MAKER_QUOTA_EXCEEDED.

Integration test: full submission flow → admin sees pending → approve.

Commit as "feat(agents-4A): listing submission and review request".
```

---

## Phase 4B: Listing Edit (Re-enters Review)

**Model: 🔴 Opus** | ~180 LOC

**Deliverables:**

- `PATCH /api/v1/agents/me/maker/listings/:id`:
  - JWT, `agents:update:listing_own`, ownership-checked
  - Allows partial updates
  - **Key behavior:** Editing a PUBLISHED listing transitions it to PENDING_REVIEW (the published version stays visible until re-approved? OR is hidden during review?)
  - **Decision:** Published listing stays visible during review of edits. Edits are stored in a "draft" overlay that takes effect only on re-approval. **Simpler MVP alternative:** Make any edit immediately move the listing to PENDING_REVIEW state (hidden from catalog until re-approved). Locking this simpler approach because the overlay model adds significant complexity for v1.
- Maker is notified by toast that listing is offline pending review
- Admin sees the changes vs prior version (compute diff at admin layer)

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 4B.

Add to ListingsService:
- updateByMaker(id, makerUserId, partialDto):
  1. Verify ownership
  2. If status = REJECTED: allow updates, stay REJECTED until re-submit
  3. If status = SUSPENDED: throw CANNOT_EDIT_SUSPENDED (admin-only path
     to unsuspend exists)
  4. If status in {DRAFT, PENDING_REVIEW}: allow updates, stay in same state
  5. If status = PUBLISHED: allow updates, transition to PENDING_REVIEW,
     dispatch AGENTS_NEW_LISTING_PENDING to admins, dispatch toast
     notification to maker

Add controller endpoint @Patch('me/maker/listings/:id')
@RequirePermission('agents:update:listing_own') @Idempotent()

Add error code: CANNOT_EDIT_SUSPENDED.

Integration tests cover all 5 status transitions on edit.

Commit as "feat(agents-4B): maker listing edit with review re-entry".
```

---

## Phase 4C: Run-Pack Management

**Model: 🟢 Sonnet** | ~180 LOC

**Deliverables:**

- `POST /me/maker/listings/:id/run-packs` — add new pack
- `PATCH /me/maker/listings/:id/run-packs/:packId` — edit pack (price, runs count, name, order)
- `DELETE /me/maker/listings/:id/run-packs/:packId` — soft-disable pack (`isActive = false`); historic purchases preserved
- Cascade: if listing transitions away from PER_RUN pricing, all packs auto-disabled
- Editing pack price does NOT retroactively affect existing purchases

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 4C.

Build RunPacksService:
- add({ listingId, makerUserId, dto }): ownership check, listing must
  be PER_RUN, max 5 active packs per listing
- update({ packId, makerUserId, dto }): ownership check, allow editing
  nameFa, runs, priceToman, order. Editing does NOT affect existing
  agents_user_runs balances or historic agents_purchase rows.
- disable({ packId, makerUserId }): set isActive=false. Existing
  purchases unaffected; new buyers can't pick this pack.

Build RunPacksController with the three endpoints, ownership-checked
via service.

Add error code: MAX_PACKS_REACHED.

Integration tests cover add/edit/disable lifecycle.

Commit as "feat(agents-4C): run-pack management endpoints".
```

---

## Phase 4D: Screenshot Management

**Model: 🟢 Sonnet** | ~150 LOC

**Deliverables:**

- `POST /me/maker/listings/:id/screenshots` — multipart upload, integrates with system FileStore (Phase 7) using `purpose: 'image'`, max 10 screenshots per listing, max 5 MB per image
- `DELETE /me/maker/listings/:id/screenshots/:scrId`
- `PATCH /me/maker/listings/:id/screenshots/order` — reorder via array of IDs

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 4D.

Build ScreenshotsService:
- add({ listingId, makerUserId, file }): ownership check, count check
  (max 10), call system FilesService.upload({ purpose: 'image',
  file, ownerUserId: makerUserId }), insert agents_screenshot row
- remove({ scrId, makerUserId }): ownership-checked delete (cascade
  via FK is OK; system File row stays for now)
- reorder({ listingId, makerUserId, orderedIds }): batch UPDATE order
  field

Build ScreenshotsController with 3 endpoints.

Add error code: MAX_SCREENSHOTS_REACHED.

Integration test full upload + reorder + delete cycle.

Commit as "feat(agents-4D): screenshot management endpoints".
```

---

## Phase 4E: API Key Generation + Rotation

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** API keys are credentials. Mistakes = makers can read each other's run data.

**Deliverables:**

- `POST /me/maker/listings/:id/api-key/rotate`:
  - JWT, ownership-checked, requires `X-Admin-Confirm: true` (for safety, even though it's the maker's own key, since rotation breaks their integration)
  - Generates new 32-byte random key (base64url encoded → 43 chars)
  - Stores `sha256(key)` in `agents_listing.apiKeyHash`
  - Stores last 8 chars in `agents_listing.apiKeyPreview` (for display only)
  - **Returns plaintext key in response — ONCE, never retrievable again**
  - Audited: `AGENTS_API_KEY_ROTATED`
- Frontend warns maker to copy key before navigating away
- Old key immediately invalidated; maker must update their integrations

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 4E.

Build ApiKeyService:
- rotate({ listingId, makerUserId }):
  1. Ownership check (maker owns listing)
  2. listing must be PER_RUN (otherwise meaningless)
  3. Generate: crypto.randomBytes(32).toString('base64url') → 43 chars
  4. Compute sha256 hash + last 8 chars preview
  5. UPDATE listing SET apiKeyHash = ..., apiKeyPreview = ...
  6. Return { plaintextKey, preview }

Build controller endpoint @Post('me/maker/listings/:id/api-key/rotate')
@RequirePermission('agents:update:listing_own')
@AdminOnly({ confirmHeader: false })  // not super-admin, but require X-Admin-Confirm equivalent custom check
@Audit({ action: 'AGENTS_API_KEY_ROTATED', resource: 'agent_listing',
  resourceIdParam: 'id' })

Use a custom decorator @RequireConfirmHeader (similar to S6) since this
isn't admin-restricted but is destructive for the maker's integrations.

Plaintext key NEVER appears in logs. Audit log records only that key
was rotated, not the new key value.

Add error codes: API_KEY_ONLY_FOR_PER_RUN.

Integration tests:
- Rotate generates new key + invalidates old
- Old key fails on /runs/consume after rotation
- New key works
- Plaintext returned only on rotation; subsequent reads of listing don't
  expose it (only preview)

Commit as "feat(agents-4E): API key generation and rotation".
```

---

## Phase 4F: Maker Sales Dashboard

**Model: 🟢 Sonnet** | ~180 LOC

**Deliverables:**

- `GET /me/maker/sales`:
  - JWT, `agents:read:sales_own`
  - Aggregated stats:
    - Total sales count, total revenue (`amountToman` sum), total maker earnings (sum of `makerEarnedToman`)
    - Per-listing breakdown: `[{ listingId, slug, titleFa, salesCount, totalEarned, totalRunsConsumed, lastSaleDate }]`
    - Recent purchases list (last 30): `[{ purchaseId, buyerHandle, listingTitleFa, amountToman, createdAt }]`
    - Pending payout (sum of `makerEarnedToman` not yet paid out — always equals total earned in v1 since no payouts happen)

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 4F.

Build MakerSalesService:
- aggregatedFor(makerUserId):
  Three queries:
  1. Totals: SELECT COUNT(*), SUM(amountToman), SUM(makerEarnedToman)
     FROM agents_purchase p JOIN agents_listing l ON l.id = p.listingId
     WHERE l.makerUserId = $1 AND p.status = 'COMPLETED'
  2. Per-listing breakdown: GROUP BY listing
  3. Recent: ORDER BY createdAt DESC LIMIT 30

Sanitize buyer info: buyerHandle = 'b.{base62(userId)}'.

Build controller endpoint @Get('me/maker/sales')
@RequirePermission('agents:read:sales_own').

Cache aggregations in Redis "agents:maker:sales:{userId}" 60s TTL.

Integration tests with seeded purchases verify aggregations correct.

Commit as "feat(agents-4F): maker sales dashboard endpoint".
```

---

## Test Gate 4: Maker Operations Verification

**Model: 🔴 Opus**

- [ ] Maker can submit listing → PENDING_REVIEW state
- [ ] Slug uniqueness enforced
- [ ] PER_RUN listing requires 1-5 packs
- [ ] Edit on PUBLISHED listing → PENDING_REVIEW
- [ ] Run packs add/edit/disable correct
- [ ] Existing purchases unaffected by pack edits
- [ ] Screenshots upload via system FileStore
- [ ] API key rotation generates new key, invalidates old
- [ ] Plaintext key never logged
- [ ] Sales dashboard aggregations correct
- [ ] All maker actions audited
- [ ] All notifications dispatched

---

# Phase Group 5 — Admin Operations + Frontend

## Phase 5A: Admin Listings Endpoints

**Model: 🔴 Opus** | ~200 LOC

**Deliverables:**

- `GET /admin/agents/listings` — all statuses, filterable
- `POST /admin/agents/listings/:id/approve` — PENDING_REVIEW → PUBLISHED + S6 confirm + audited
- `POST /admin/agents/listings/:id/reject` — PENDING_REVIEW → REJECTED + reason + S6 confirm + audited
- `POST /admin/agents/listings/:id/suspend` — PUBLISHED → SUSPENDED + reason + S6 confirm + audited
- `POST /admin/agents/listings/:id/unsuspend` — SUSPENDED → PUBLISHED + S6 confirm + audited

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 5A.

Build AdminListingsController with 5 endpoints. All require
@RequirePermission('agents:moderate:listing') and
@AdminOnly({ confirmHeader: true }).

Each transition uses ListingsService methods from Phase 2A
(approve/reject/suspend/unsuspend).

Each endpoint @Audit-decorated with corresponding action code.

Integration tests cover full moderation lifecycle.

Commit as "feat(agents-5A): admin listings moderation endpoints".
```

---

## Phase 5B: Admin Categories CRUD + Featured Ordering + Settings

**Model: 🟢 Sonnet** | ~200 LOC

**Deliverables:**

- Categories: full CRUD (`agents:manage:categories`)
- Featured: `POST /admin/agents/listings/:id/feature`, `DELETE /:id/feature`, `PATCH /admin/agents/featured/order` (reorder)
- Settings: `GET /admin/agents/settings`, `PATCH /admin/agents/settings` (commission, sections, hero copy)
- All admin mutations audited

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 5B.

Build:
- AdminCategoriesController: full CRUD
- AdminFeaturedController: feature/unfeature + reorder
- AdminSettingsController: GET + PATCH (settings)

All endpoints with appropriate permissions and S6 confirm on mutations.

Soft-delete on category: only allowed if no listings reference. Else
throw CATEGORY_HAS_LISTINGS.

Settings PATCH: validates commissionPercent 0-50, section flags boolean,
hero copy lengths.

Each endpoint @Audit-decorated.

Integration tests cover all CRUD flows.

Commit as "feat(agents-5B): admin categories, featured, settings".
```

---

## Phase 5C: Admin Sales View + Refund + Reviews Moderation

**Model: 🟢 Sonnet** | ~180 LOC

**Deliverables:**

- `GET /admin/agents/sales` — all purchases, filter by date/listing/maker/status
- `POST /admin/agents/sales/:purchaseId/refund` — delegates to system Phase 10E refund flow + sets agents_purchase status to REFUNDED + dispatches notifications + S6 confirm
- `GET /admin/agents/reviews` — all reviews
- `POST /admin/agents/reviews/:id/hide` — hide review with reason + S6 confirm

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 5C.

Build AdminSalesController with sales endpoints + refund delegation.
Refund flow:
1. Verify agents_purchase exists, status COMPLETED
2. Call system PaymentsService.refund (Phase 10E) — for v1 with no real
   payment, the refund creates a Refund row with PENDING_MANUAL status
3. Update agents_purchase status to REFUNDED, set refundReason and
   refundedAt
4. If PER_RUN: decrement agents_user_runs.remainingRuns by purchase
   amount, but NEVER below 0 (if user already consumed some, the refund
   only zeros remaining; full-refund-with-consumption-clawback is a v1.5
   problem)
5. Dispatch AGENTS_PURCHASE_REFUNDED to buyer

Build AdminReviewsController with list + hide endpoints.

Integration tests cover refund flow, review hide flow.

Commit as "feat(agents-5C): admin sales view + refund + review moderation".
```

---

## Phase 5D: Frontend — Main Marketplace Page

**Model: 🔴 Opus** | ~220 LOC

**Why Opus:** Visual identity surface. Translates dark-terminal mockup spirit into light-brand language correctly is non-trivial.

**Deliverables:**

- `apps/web/src/app/(public)/agents/page.tsx` (or `(account)/agents/page.tsx` if we want auth-aware default; choose `(public)` since marketplace is browseable anonymously)
- Sections in order:
  1. **Hero** — Title from settings.heroTitleFa with `// AGENTS` mono badge, subtitle, two CTAs ("کشف عامل‌ها" → catalog, "saziqo publish $" → maker submit)
  2. **Recent activity strip** — light card with terminal-style header `$ tail -f /var/log/saziqo`, mono rows of recent installs/purchases (orange `>` glyph, mono handle, agent.slug, action verb, mono timestamp)
  3. **Categories grid** — 7 cards with pastel color tokens + lucide icon + Persian name + agent count
  4. **Featured section** — header `// FEATURED` mono orange, then grid of 3-6 featured cards with brand-orange "FEATURED ★" badge
  5. **Best sellers** — same card grid, header `// BEST SELLERS`
  6. **New releases** — same, header `// NEW RELEASES //`
- Responsive: desktop 3-column featured grid, mobile 1-column
- All sections respect `agents_settings.showXSection` flags
- Light theme + brand orange + Vazirmatn body + JetBrains Mono accents (only for `$`, `>`, `//`, slugs)

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 5D.

Install: lucide-react (already from system), @tanstack/react-query
(already from system Phase 12).

Build apps/web/src/app/(public)/agents/page.tsx as a server component
that pre-fetches data via React Query SSR or simple fetch + props.

Components to build under apps/web/src/components/agents/:
- AgentsHero.tsx: title from settings, subtitle, two CTAs. Top-right
  mono badge "AGENTS / N MAKERS / N RUNS — saziqo init $" rendered in
  mono with orange "$" character.
- RecentActivityStrip.tsx: light card with mono header "$ tail -f
  /var/log/saziqo", scrolling/static list of last 5 events. Each row:
  mono "@handle  agent.slug  ACTION  TIMESTAMP" with orange ">" prefix.
- CategoriesGrid.tsx: 7 light cards on bg-soft, each with pastel
  rounded-lg color tile + lucide icon + Persian name + small "AGENTS N"
  count below.
- ListingGrid.tsx: reusable card grid with ListingCard.tsx.
- ListingCard.tsx: white card with subtle shadow + 1px line border. Top
  badge if featured (orange "FEATURED ★" mono). Mono slug at top right
  in muted ink. Persian title (Vazirmatn semibold). One-line shortDesc.
  Stats footer: USERS / RATE / RUNS in mono with subtle gradient pills.
- SectionHeader.tsx: mono orange uppercase header "// FEATURED" pattern.

Color tokens for category tiles (Tailwind):
- lavender: bg-purple-100
- mint: bg-emerald-100
- sky: bg-sky-100
- rose: bg-rose-100
- periwinkle: bg-indigo-100
- lemon: bg-yellow-100
- sand: bg-amber-100

Page composition:
- Hero (h-[60vh] min)
- Recent activity strip
- Categories grid (visible if settings.showCategoriesSection)
- Featured (visible if settings.showFeaturedSection)
- Best sellers (visible if settings.showBestSellersSection)
- New releases (visible if settings.showNewReleasesSection)

All Persian RTL. All sections fetch on the server, pass to client
components only where interactive (CTAs, hover states).

Verify visually:
- Light theme correct
- Brand orange used for accents only (CTA, badges, mono $/>//)
- Vazirmatn for Persian, JetBrains Mono for terminal accents
- Mobile responsive

Commit as "feat(agents-5D): main marketplace page with light-terminal aesthetic".
```

---

## Phase 5E: Frontend — Listing Detail Page

**Model: 🔴 Opus** | ~200 LOC

**Deliverables:**

- `/agents/[slug]` page
- Sections: title + maker info + rating, screenshot carousel, long description (markdown rendered), pricing block (different for FREE / ONE_TIME / PER_RUN), reviews section
- Pricing block:
  - FREE: orange "نصب رایگان" CTA
  - ONE_TIME: price displayed prominently, "افزودن به سبد" CTA
  - PER_RUN: list of run packs as radio cards, "افزودن به سبد" CTA (uses selected pack)
- Cart-add interaction: `useMutation` → success toast → cart icon counter increments
- Already-owned state: replace CTA with "در کتابخانه شما — مشاهده"
- Already-has-runs state for PER_RUN: show remaining count + "خرید بسته بیشتر" CTA
- Maker handle as link to maker's other listings (future page; for v1 show as plain mono text)

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 5E.

Install: react-markdown (or unified + remark-parse + rehype-react), and
the PrismJS for code-block highlight in maker descriptions (or just use
rehype-highlight).

Build apps/web/src/app/(public)/agents/[slug]/page.tsx — server component.

Components:
- ListingDetailHero.tsx: title + maker handle + rating + categories +
  short desc
- ScreenshotCarousel.tsx: shadcn-based or custom; show 1 large image at
  a time with thumbnail row
- ListingMarkdown.tsx: react-markdown with custom renderers for
  Persian-aware typography
- PricingBlock.tsx: switches on pricingType:
  - FREE: install CTA
  - ONE_TIME: price + cart-add CTA
  - PER_RUN: <RunPackPicker /> radio + cart-add CTA
- RunPackPicker.tsx: vertical radio cards, each showing pack nameFa,
  runs count (mono), price, computed "per-run cost" text
- ReviewsSection.tsx: rating distribution bar + review list
- OwnershipBanner.tsx: shows when user owns this listing — different
  states for FREE/ONE_TIME/PER_RUN

Cart-add mutation: useMutation calls POST /api/v1/agents/cart with
idempotencyKey. On success: toast + invalidate cart query (which is
read by header cart icon).

Edge cases:
- Listing PENDING/REJECTED/SUSPENDED: 404 page (RedirectTo /agents)
- Anonymous user clicking install/buy: redirect to /login with
  returnUrl=/agents/[slug]

Verify all 4 ownership states render correctly.

Commit as "feat(agents-5E): listing detail page with pricing block".
```

---

## Phase 5F: Frontend — Category, Search, Submit Pages

**Model: 🟢 Sonnet** | ~200 LOC

**Deliverables:**

- `/agents/category/[slug]` — listing grid with filter sidebar (pricing type, free-only, min rating, sort)
- `/agents/search` — same grid with FTS query in header + filter sidebar + "no results" empty state
- `/agents/submit` — multi-step form (basic info → category + pricing → packs (if PER_RUN) → screenshots upload → submit-for-review)

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 5F.

Build:
- /agents/category/[slug]/page.tsx with FilterSidebar.tsx + ListingGrid
- /agents/search/page.tsx with FilterSidebar + ListingGrid + EmptyState
- /agents/submit/page.tsx — auth-required, redirects to /login if
  not authenticated. Multi-step form via shadcn-style stepper.

Submit form steps:
1. Basic info: slug (auto-generate from titleFa with override option),
   titleFa, shortDescFa, longDescFaMd (markdown editor — use simple
   <textarea> for v1, fancy editor v1.5)
2. Category + pricing: category dropdown, pricing type radio, conditional
   price input or run packs builder
3. Run packs (if PER_RUN): inline editor for 1-5 packs
4. Screenshots: drag-and-drop multi-upload, 1-10 images
5. Submit: review summary, confirm checkbox "محتوای من با شرایط
   استفاده انطباق دارد", "ارسال برای بررسی" CTA

Each step validates before proceeding. Saved as DRAFT after step 1
completion (POST /me/maker/listings creates DRAFT immediately, subsequent
steps PATCH it). Final submit calls submit-for-review endpoint.

Commit as "feat(agents-5F): category, search, submit pages".
```

---

## Phase 5G: Frontend — Cart, Checkout, Library Pages

**Model: 🔴 Opus** | ~200 LOC

**Deliverables:**

- `/cart` — list of cart items grouped by module (only `agents` for now), per-item remove, totals, "تسویه" CTA
- `/checkout` — final review, "تأیید و تکمیل" CTA, on submit calls `/checkout` endpoint, redirects to `/checkout/success/{purchaseIds[0]}`
- `/checkout/success/[purchaseId]` — receipt page with downloads + library link
- `/account/library` — list of owned listings with download/review CTAs and per-listing remaining runs (if PER_RUN)

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 5G.

Hybrid cart frontend logic:
- apps/web/src/store/cart.store.ts (Zustand): manages localStorage cart
  for guests; exposes addToLocalCart, removeFromLocalCart, clearLocalCart
- On login (auth bootstrap): if local cart has items, call POST /cart/merge
  with payload, then clear localStorage, then refetch /cart from server
- After login: cart store reads from server query (useQuery /cart),
  mutations call server endpoints, then invalidate

Build:
- /cart/page.tsx: cart aggregator render. Lines from agents module shown
  with title, maker handle, pricing type, price (formatted with toman),
  remove button. Total at bottom. "تسویه" CTA.
- /checkout/page.tsx: re-fetches cart, shows summary, idempotency-key
  generated client-side, "تأیید و تکمیل" calls POST /checkout. On 200:
  router.push(`/checkout/success/${response.data.purchaseIds[0]}`)
- /checkout/success/[purchaseId]/page.tsx: shows purchased items, download
  CTAs for ONE_TIME/PER_RUN, install instructions
- /account/library/page.tsx: cards for each owned listing. PER_RUN cards
  show "X اجرا باقی مانده" and "خرید بسته بیشتر" link to listing detail.

Empty states:
- Empty cart: "سبد شما خالی است" + link to /agents
- Empty library: "هنوز ایجنتی نخریده‌اید" + link to /agents

Commit as "feat(agents-5G): cart, checkout, library pages".
```

---

## Phase 5H: Frontend — Maker Dashboard

**Model: 🟢 Sonnet** | ~200 LOC

**Deliverables:**

- `/account/maker/listings` — table of own listings with status badges, click row → edit page
- `/account/maker/listings/[id]` — edit form (reuses submit form components from 5F, pre-filled)
- `/account/maker/sales` — stats dashboard with totals + per-listing breakdown + recent purchases list

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 5H.

Build:
- /account/maker/listings/page.tsx: table from /me/maker/listings
  endpoint. Columns: title, status (badge with color), pricing type,
  total sales, total runs, last update. Row click → /account/maker/
  listings/[id]
- /account/maker/listings/[id]/page.tsx: edit form (multi-step, same as
  submit). On save: PATCH /me/maker/listings/:id. If currently PUBLISHED,
  show banner "ویرایش‌ها بعد از تأیید مدیر منتشر می‌شوند"
- /account/maker/sales/page.tsx: dashboard with:
  - Top stats cards: total revenue (toman), total sales count, runs sold,
    pending payout (= total earned, since no payouts in v1)
  - Per-listing table with mini bar chart (use recharts)
  - Recent 30 purchases table

Status badges:
- DRAFT: gray
- PENDING_REVIEW: orange (matches brand) "در انتظار بررسی"
- PUBLISHED: green "منتشر شده"
- REJECTED: red "رد شده"
- SUSPENDED: dark red "تعلیق شده"

Commit as "feat(agents-5H): maker dashboard pages".
```

---

## Phase 5I: Frontend — Admin Pages

**Model: 🔴 Opus** | ~220 LOC

**Deliverables:**

- `/admin/agents/listings` — moderation queue table with filter (status default PENDING_REVIEW)
- `/admin/agents/listings/[id]` — admin detail with full listing info, "تأیید", "رد" (with reason dialog), "تعلیق" (with reason dialog), "حذف انتخاب از منتخبان"
- `/admin/agents/categories` — CRUD table with inline edit
- `/admin/agents/featured` — drag-to-reorder featured list (use `@dnd-kit/sortable`)
- `/admin/agents/sales` — table with filters + export-to-CSV button (CSV generation client-side from JSON)
- `/admin/agents/settings` — form with commission percent slider + section flags + hero copy editor

**Claude Code prompt:**

```
Read system plan files plus AGENTS_MODULE_PLAN.md and AGENTS_MODULE_
PHASES_1_5.md fully. Execute Phase 5I.

Install: @dnd-kit/core, @dnd-kit/sortable.

Build:
- /admin/agents/listings/page.tsx: table with filter dropdowns. Default
  filter status=PENDING_REVIEW (the moderation queue). Click row → detail
- /admin/agents/listings/[id]/page.tsx: full detail view. Sidebar shows
  maker info + listing metadata. Main area shows listing as it would
  appear publicly. Action panel at bottom: 4 buttons (approve, reject,
  suspend, unsuspend) gated by current status. Reason dialog for reject
  and suspend (Persian textarea).
- /admin/agents/categories/page.tsx: editable table with shadcn Table
- /admin/agents/featured/page.tsx: list with drag handle for reordering;
  on drop, calls PATCH /admin/agents/featured/order
- /admin/agents/sales/page.tsx: filterable table + Export CSV button
  (papaparse to generate CSV from current data)
- /admin/agents/settings/page.tsx: form with shadcn Slider for commission
  (0-50%), Switch components for section flags, Input components for
  hero copy, Save button (PATCH /admin/agents/settings)

All admin actions send X-Admin-Confirm: true header (use the
adminMutate helper from system Phase 14E).

Commit as "feat(agents-5I): admin pages for agents module".
```

---

## Test Gate 5: Module Launch-Ready

**Model: 🔴 Opus**

**End-to-end flows:**

- [ ] Anonymous user browses `/agents`, all sections render correctly in light theme with terminal accents
- [ ] Anonymous user opens listing detail, sees pricing, clicks "افزودن به سبد" → redirected to `/login`
- [ ] After login: cart still has the item (guest cart merge worked)
- [ ] Buyer completes checkout for FREE → library shows item → can download
- [ ] Buyer completes checkout for ONE_TIME → library shows item → can download
- [ ] Buyer completes checkout for PER_RUN → library shows runs counter
- [ ] Buyer downloads bundle (system FileStore integration works)
- [ ] Buyer leaves a review → maker receives notification
- [ ] Maker submits new listing → PENDING_REVIEW
- [ ] Admin sees notification, reviews, approves → maker notified, listing published
- [ ] Admin pins listing as featured → appears on /agents homepage
- [ ] Maker rotates API key → old key fails on /runs/consume → new key works
- [ ] Run consumption decrements correctly; threshold notifications fire
- [ ] Admin refunds purchase → buyer notified, runs (if PER_RUN) zeroed
- [ ] All admin destructive actions require S6 confirm header
- [ ] No console errors in any page
- [ ] Mobile viewport works for all 14+ frontend pages
- [ ] All Persian copy renders RTL correctly
- [ ] Brand orange used consistently for CTAs and accents only
- [ ] JetBrains Mono used only for terminal accents (`$`, `>`, `//`, slugs, stat blocks)

---

# What Comes After Phase Group 5

Module is **launch-ready**. After Test Gate 5 passes, the Agents Marketplace is live and the platform has its first revenue-capable module (revenue captures via internal ledger; cash flow begins when ZarinPal is wired in).

**Next sequence (separate plan files):**

1. **Templates Marketplace** — schema is ~70% identical to agents; estimated 60% effort vs agents
2. **Tools & Docs subscription** — different model, reuses payment + ledger
3. **Builders Marketplace** — most complex; bidding, escrow, chat
4. **DevOps + Security combined** — small lead-capture modules

**Deferred features that should reopen post-launch:**

1. Real ZarinPal payment processing (one-line provider swap; payment-callback already wired)
2. Maker payouts (system Phase 9D payout queue is built; just needs the trigger)
3. Webhooks for makers (notify on sale, review, etc.)
4. Search ranking sophistication (move from Postgres FTS to Meilisearch when results stop being good enough)
5. Subscription pricing per agent (if user demand emerges; currently considered out-of-scope)
6. Rich agent install flow (install-into-Claude-Code wizard, etc.)

---

## Open Decisions That Block Launch

These do not block planning. They block real-money launch:

1. **Maker payout policy** — when payments go live, what's the payout cadence (weekly/monthly/on-demand)? Minimum threshold?
2. **Refund policy** — exact terms (suggested in master plan: 7-day for ONE_TIME, unused-runs only for PER_RUN, no refund for FREE)
3. **Initial seed listings** — recommend ~30 published listings before public launch to avoid empty marketplace
4. **Maker terms of service** — Persian legal document covering commission, content rules, takedown rights
5. **Buyer terms of service** — covers refund rights, agent quality expectations
6. **Run-consume API documentation page** — public docs at `/docs/maker-api` (small Astro page on `saziqo.ir` website, OR a doc page within the platform itself; recommend website to keep platform focused on app functionality)

These are user/team responsibilities, not Claude Code's.
