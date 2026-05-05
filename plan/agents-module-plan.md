# سازیکو Agents Marketplace Module — Master Skeleton

## Module Identity

- **Module name:** `agents`
- **Persian name:** بازارگاه ایجنت‌ها
- **Tagline (Persian):** «عامل‌های فارسی، به دست سازندگان ایرانی.»
- **Module version:** `0.1.0`
- **API routes:** `/api/v1/agents/...`
- **Public frontend:** `/agents/*`
- **Account frontend:** `/account/library`, `/account/maker/*`
- **Admin frontend:** `/admin/agents/*`
- **Plan structure:** This file (master skeleton) + `agents-module-phases-1-5.md` (executable detail for all 5 phase groups)
- **Built on top of:** Saziqo Platform system layer (assumes Phase Groups 1–16 of the system plan are deployed)

---

## Locked Decision Contract

| #   | Decision                 | Locked value                                                                                                                                                                                                        |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Theme                    | **Light brand + terminal accents** — light mode (`#ffffff`/`#f8fafc` backgrounds, ink text, brand orange `#f97316`), with JetBrains Mono accents and `$` prompt glyphs as the "terminal motif." NO theme inversion. |
| 2   | Maker flow + reviews     | **Built in v1** — `/agents/submit`, maker dashboard, 1–5 star reviews on purchased agents                                                                                                                           |
| 3   | Pricing models supported | **Free, One-time, Per-run packs** — exactly one model per listing                                                                                                                                                   |
| 4   | Listing approval         | **Manual review** — every listing transitions PENDING_REVIEW → PUBLISHED only via admin action                                                                                                                      |
| 5   | Cart persistence         | **Hybrid** — localStorage for guests; merges to DB cart on login                                                                                                                                                    |
| 6   | Platform commission      | **20% default** — stored in `agents_settings` table, admin-editable; future-proof for when payments turn on                                                                                                         |
| 7   | Run-pack purchases       | **Cumulative** — buying a second pack adds runs to existing balance for that listing                                                                                                                                |
| 8   | Run consumption endpoint | **Live in v1** — makers receive a per-listing API key and call `POST /api/v1/agents/runs/consume` to decrement counters                                                                                             |

### Cuts deferred from v1

- **Real payment processing** — checkout creates a `COMPLETED` order without ZarinPal call. Schema is payment-ready; flipping the switch is a one-line provider swap (system Phase Group 10 already built the abstraction).
- **Maker payouts** — no payment → no payouts. `agents_purchase` records owed-amounts; payout queue stays empty until payments are live.
- **Agent download/install delivery UX beyond raw file** — buyer can download the maker-uploaded bundle via system FileStore + read maker's Persian instructions. No deep "install into Claude Code" flow.
- **Webhooks for makers** — sale-notification webhooks deferred. Makers see sales in their dashboard.
- **Search ranking sophistication** — Postgres `tsvector` with weighted fields is enough for v1. Meilisearch arrives only when search quality becomes a real problem.
- **Subscription pricing per agent** — explicitly not in scope. Subscriptions live in Tools & Docs module.
- **Recurring "renewals" of run packs** — buyer manually purchases more packs when they want. Auto-recharge deferred.

---

## Visual Language — Light Brand with Terminal Accents

The reference mockups the user shared use a dark theme. We translate the **spirit** into light theme as follows:

| Mockup element                   | Light-theme translation                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Black background `#000`          | `#ffffff` for hero, `#f8fafc` for sections, `#0f172a` ink for text                                    |
| Neon green `#A3E635` glyphs      | Brand orange `#f97316` for `$` prompts, accents, CTAs                                                 |
| Mono terminal type for labels    | JetBrains Mono only for `$` prompts, agent slugs, stats blocks; Vazirmatn for Persian body            |
| `tail -f /var/log/saziqo` widget | A softened "آخرین فعالیت‌ها" panel — light card, mono row entries, orange `>` glyph per row           |
| Featured cards over dark         | Featured cards on `#ffffff` with subtle shadow and 1px `#e2e8f0` border, pastel category-color badges |
| Black "saziqo init $" CTA        | Orange `#f97316` solid pill button with `$` glyph + Persian label                                     |

**Terminal motif elements that survive:**

- `$ saziqo init` style hero accent line (mono, orange `$`, ink text)
- `agent.slug-name` displays everywhere in mono
- Stats blocks (USERS / RATE / RUNS) in mono with subtle gradient backgrounds
- "Featured ★", "Verified ✓", "New //" badges using mono
- Maker handle `@username` in mono with orange `@`
- Section headers like `// FEATURED` use mono uppercase orange

**What does NOT carry over:**

- Black backgrounds anywhere
- Neon green
- Dark cards
- High-contrast white-on-black text

---

## Pricing Models In Detail

A listing's `pricing_type` is one of three (subscription deferred):

### `FREE`

- Buyer "installs" — recorded as a row in `agents_purchase` with `amount = 0`
- No payment. No counter. Lifetime access.
- Free agents drive marketplace activity and act as makers' portfolio pieces.

### `ONE_TIME`

- Buyer pays a single flat fee. Lifetime access.
- Maker sets price in toman (BIGINT).

### `PER_RUN` (run packs)

- Maker defines 1–5 named **run packs** per listing. Each pack: `{ name, runs, priceToman }`.
- Buyer chooses ONE pack at checkout (radio choice on detail page → cart line carries `pack_id`).
- After purchase, buyer's library shows total remaining runs for that listing.
- **Buying a second pack adds to existing balance** (cumulative, per locked decision 7).
- Each "run" is decremented when the maker's external service calls our consume endpoint with their listing API key.
- When balance hits 0, the consume endpoint returns `409 INSUFFICIENT_RUNS` and buyer sees "Buy more runs" CTA in library.

### What counts as "a run"

The platform does not enforce semantics. The maker decides whether one user click, one API call, one chat session, or one document export is a "run." The platform tracks the counter; the maker enforces the policy. Documentation makes this clear to both makers and buyers.

---

## Module Contract Implementation

### `registerPermissions()` — 14 permissions

```typescript
[
  // Buyer-facing
  { code: 'agents:read:catalog', description: 'Browse the agents catalog' },
  { code: 'agents:read:listing', description: 'View a listing detail page' },
  { code: 'agents:purchase:listing', description: 'Buy or install a listing' },
  { code: 'agents:download:owned', description: 'Download files from owned listings' },
  { code: 'agents:review:owned', description: 'Leave a review for a purchased listing' },
  {
    code: 'agents:consume:run',
    description: 'Decrement own run counter (called by maker via API key)',
  },

  // Maker-facing
  { code: 'agents:create:listing', description: 'Submit a new agent listing' },
  { code: 'agents:update:listing_own', description: 'Edit own listings (drafts and published)' },
  { code: 'agents:read:sales_own', description: 'View own sales dashboard' },

  // Admin-facing
  { code: 'agents:moderate:listing', description: 'Approve, reject, suspend listings' },
  { code: 'agents:manage:categories', description: 'CRUD on categories' },
  { code: 'agents:manage:featured', description: 'Pin/unpin featured listings' },
  { code: 'agents:read:sales_all', description: 'View all sales across the marketplace' },
  {
    code: 'agents:manage:settings',
    description: 'Edit module settings (commission, sections, hero copy)',
  },
];
```

Default role assignments: every authenticated `user` gets the buyer-facing 6 + the maker-facing 3 (any user can become a maker by submitting); admin gets the 5 admin permissions; super_admin always passes via `super:everything`.

### `registerAuditActions()` — 18 actions

```typescript
{
  AGENTS_LISTING_SUBMITTED:     'AGENTS_LISTING_SUBMITTED',
  AGENTS_LISTING_APPROVED:      'AGENTS_LISTING_APPROVED',
  AGENTS_LISTING_REJECTED:      'AGENTS_LISTING_REJECTED',
  AGENTS_LISTING_SUSPENDED:     'AGENTS_LISTING_SUSPENDED',
  AGENTS_LISTING_UNSUSPENDED:   'AGENTS_LISTING_UNSUSPENDED',
  AGENTS_LISTING_UPDATED:       'AGENTS_LISTING_UPDATED',
  AGENTS_LISTING_FEATURED:      'AGENTS_LISTING_FEATURED',
  AGENTS_LISTING_UNFEATURED:    'AGENTS_LISTING_UNFEATURED',
  AGENTS_PURCHASE_COMPLETED:    'AGENTS_PURCHASE_COMPLETED',
  AGENTS_PURCHASE_REFUNDED:     'AGENTS_PURCHASE_REFUNDED',
  AGENTS_REVIEW_POSTED:         'AGENTS_REVIEW_POSTED',
  AGENTS_REVIEW_REMOVED:        'AGENTS_REVIEW_REMOVED',
  AGENTS_RUN_CONSUMED:          'AGENTS_RUN_CONSUMED',
  AGENTS_RUN_REFUSED_INSUFFICIENT: 'AGENTS_RUN_REFUSED_INSUFFICIENT',
  AGENTS_API_KEY_ROTATED:       'AGENTS_API_KEY_ROTATED',
  AGENTS_CATEGORY_CREATED:      'AGENTS_CATEGORY_CREATED',
  AGENTS_CATEGORY_UPDATED:      'AGENTS_CATEGORY_UPDATED',
  AGENTS_SETTINGS_UPDATED:      'AGENTS_SETTINGS_UPDATED',
}
```

### `registerNotificationTypes()` — 9 templates (Persian)

- `AGENTS_LISTING_APPROVED` — IN_APP + SMS to maker
- `AGENTS_LISTING_REJECTED` — IN_APP + SMS to maker (with reason)
- `AGENTS_LISTING_SUSPENDED` — IN_APP to maker (with reason)
- `AGENTS_PURCHASE_RECEIPT` — IN_APP to buyer
- `AGENTS_NEW_SALE` — IN_APP to maker (without payment, this is "your agent was installed/purchased")
- `AGENTS_RUNS_LOW` — IN_APP to buyer when remaining runs ≤ 10% of last pack
- `AGENTS_RUNS_DEPLETED` — IN_APP to buyer when remaining = 0
- `AGENTS_REVIEW_POSTED` — IN_APP to maker (someone reviewed your agent)
- `AGENTS_NEW_LISTING_PENDING` — IN_APP to all admins (a listing is awaiting review)

### `registerAdminPages()` — 5 pages

```typescript
[
  {
    path: '/admin/agents/listings',
    titleFa: 'لیستینگ‌ها',
    icon: 'package',
    permission: 'agents:moderate:listing',
    order: 200,
  },
  {
    path: '/admin/agents/categories',
    titleFa: 'دسته‌بندی‌ها',
    icon: 'folder-tree',
    permission: 'agents:manage:categories',
    order: 210,
  },
  {
    path: '/admin/agents/featured',
    titleFa: 'منتخبان',
    icon: 'star',
    permission: 'agents:manage:featured',
    order: 220,
  },
  {
    path: '/admin/agents/sales',
    titleFa: 'فروش‌ها',
    icon: 'trending-up',
    permission: 'agents:read:sales_all',
    order: 230,
  },
  {
    path: '/admin/agents/settings',
    titleFa: 'تنظیمات بازارگاه',
    icon: 'settings',
    permission: 'agents:manage:settings',
    order: 240,
  },
];
```

### `registerPaymentPurposes()`

```typescript
['agents_purchase', 'agents_run_pack'];
```

When real ZarinPal turns on, payment-callback listener (Phase 10D system layer) routes these purposes to the agents module's reconciler, which credits the maker's wallet and grants the buyer access.

---

## Database Schema

All tables prefixed `agents_`. All money in BIGINT toman. All IDs BigInt.

```prisma
// ============================================================
// CATALOG
// ============================================================

model agents_category {
  id              BigInt   @id @default(autoincrement())
  slug            String   @unique @db.VarChar(80)
  nameFa          String   @db.VarChar(100)
  iconKey         String   @db.VarChar(40)        // 'edit-pencil', 'flask', 'briefcase' — frontend maps to lucide icon
  colorToken      String   @db.VarChar(20)        // 'lavender', 'mint', 'sky', 'rose', 'lemon', 'periwinkle', 'sand'
  order           Int      @default(0)
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([order])
  @@index([isActive])
}

model agents_listing {
  id                BigInt   @id @default(autoincrement())
  slug              String   @unique @db.VarChar(120)         // 'persian-copywriter', 'code-reviewer-fa'
  titleFa           String   @db.VarChar(200)
  shortDescFa       String   @db.VarChar(300)                  // 1-line description for cards
  longDescFaMd      String   @db.Text                          // markdown body for detail page
  installInstructionsFaMd String? @db.Text                     // post-purchase Persian instructions
  categoryId        BigInt
  makerUserId       BigInt
  pricingType       AgentsPricingType                          // FREE | ONE_TIME | PER_RUN
  oneTimePriceToman BigInt?                                    // null unless ONE_TIME
  status            AgentsListingStatus                        // DRAFT | PENDING_REVIEW | PUBLISHED | REJECTED | SUSPENDED
  rejectionReason   String?  @db.VarChar(500)
  suspensionReason  String?  @db.VarChar(500)
  isFeatured        Boolean  @default(false)
  featuredOrder     Int?                                       // sort order in featured section
  bundleFileId      BigInt?                                    // FK to system File (the downloadable agent bundle)
  apiKeyHash        String?  @db.VarChar(64)                   // sha256 of generated API key for run-consumption (PER_RUN only)
  apiKeyPreview     String?  @db.VarChar(20)                   // last 8 chars for display, e.g. "...d4f9c2a1"
  totalUsers        BigInt   @default(0)                       // denormalized — count of distinct buyers
  totalRuns         BigInt   @default(0)                       // denormalized — total runs consumed across all buyers
  ratingAverage     Decimal? @db.Decimal(3,2)                  // null until first review
  ratingCount       BigInt   @default(0)
  searchVector      Unsupported("tsvector")?                   // Postgres FTS column
  publishedAt       DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  deletedAt         DateTime?
  @@index([status, publishedAt])
  @@index([categoryId, status])
  @@index([makerUserId])
  @@index([isFeatured, featuredOrder])
  @@index([deletedAt])
}

enum AgentsPricingType   { FREE ONE_TIME PER_RUN }
enum AgentsListingStatus { DRAFT PENDING_REVIEW PUBLISHED REJECTED SUSPENDED }

model agents_screenshot {
  id          BigInt @id @default(autoincrement())
  listingId   BigInt
  fileId      BigInt          // FK to system File
  order       Int  @default(0)
  altTextFa   String? @db.VarChar(200)
  @@index([listingId, order])
}

model agents_run_pack {
  // Run-pack definitions on a PER_RUN listing. 1-5 packs per listing.
  id              BigInt @id @default(autoincrement())
  listingId       BigInt
  nameFa          String @db.VarChar(80)                       // e.g. "بسته شروع"
  runs            BigInt                                        // count
  priceToman      BigInt
  order           Int    @default(0)
  isActive        Boolean @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([listingId, order])
}

// ============================================================
// CART
// ============================================================

model agents_cart_item {
  id              BigInt @id @default(autoincrement())
  userId          BigInt                                         // null on anonymous (cart is then in localStorage)
  listingId       BigInt
  runPackId       BigInt?                                        // required if listing.pricingType = PER_RUN
  addedAt         DateTime @default(now())
  @@unique([userId, listingId, runPackId])                       // can have at most one of each (listing, pack) combo
  @@index([userId, addedAt])
}

// ============================================================
// PURCHASE / OWNERSHIP / RUNS
// ============================================================

model agents_purchase {
  // Records a completed purchase. Append-only.
  id                  BigInt @id @default(autoincrement())
  userId              BigInt                                     // buyer
  listingId           BigInt
  pricingTypeAtSale   AgentsPricingType                          // captured at time of sale (frozen contract)
  runPackId           BigInt?                                    // null unless PER_RUN
  runsGranted         BigInt @default(0)                         // 0 for FREE/ONE_TIME, pack.runs for PER_RUN
  amountToman         BigInt                                     // total paid
  commissionToman     BigInt                                     // platform's cut at sale time
  makerEarnedToman    BigInt                                     // amountToman - commissionToman
  systemPaymentId     BigInt?                                    // FK to system Payment (when payments live)
  status              AgentsPurchaseStatus                       // COMPLETED | REFUNDED
  refundReason        String? @db.VarChar(500)
  createdAt           DateTime @default(now())
  refundedAt          DateTime?
  @@index([userId, createdAt])
  @@index([listingId, createdAt])
  @@index([status])
}

enum AgentsPurchaseStatus { COMPLETED REFUNDED }

model agents_user_runs {
  // Per-user, per-listing remaining run counter for PER_RUN pricing.
  // Cumulative — buying additional packs increments this.
  id              BigInt @id @default(autoincrement())
  userId          BigInt
  listingId       BigInt
  remainingRuns   BigInt @default(0)
  totalGranted    BigInt @default(0)                             // total ever granted (lifetime)
  totalConsumed   BigInt @default(0)                             // total ever consumed (lifetime)
  lastConsumedAt  DateTime?
  @@unique([userId, listingId])                                  // one row per user+listing
  @@index([userId])
  @@index([listingId])
}

model agents_run_event {
  // Append-only ledger of every run consumption attempt. Used for analytics, dispute resolution, and the AGENTS_RUN_CONSUMED audit trail.
  id              BigInt @id @default(autoincrement())
  userId          BigInt
  listingId       BigInt
  outcome         AgentsRunOutcome                               // CONSUMED | REFUSED_INSUFFICIENT | REFUSED_INVALID_KEY
  ipAddress       String?  @db.VarChar(45)
  userAgent       String?  @db.VarChar(255)
  createdAt       DateTime @default(now())
  @@index([userId, listingId, createdAt])
  @@index([listingId, createdAt])
}

enum AgentsRunOutcome { CONSUMED REFUSED_INSUFFICIENT REFUSED_INVALID_KEY }

// ============================================================
// REVIEWS
// ============================================================

model agents_review {
  id              BigInt @id @default(autoincrement())
  listingId       BigInt
  authorUserId    BigInt
  rating          Int                                            // 1-5
  bodyFa          String? @db.VarChar(2000)
  isHidden        Boolean @default(false)                        // admin-moderated
  hiddenReason    String? @db.VarChar(500)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([listingId, authorUserId])                            // one review per buyer per listing
  @@index([listingId, createdAt])
  @@index([authorUserId])
}

// ============================================================
// SETTINGS
// ============================================================

model agents_settings {
  // Singleton row (id = 1). Admin-editable.
  id                            BigInt   @id @default(1)
  commissionPercent             Int      @default(20)            // platform commission (locked decision 6)
  heroTitleFa                   String   @db.VarChar(200) @default('عامل‌های فارسی، به دست سازندگان ایرانی.')
  heroSubtitleFa                String   @db.VarChar(500) @default('از پنل کشف عامل‌های آماده، تا استودیوی انتشار و کسب درآمد — همه در یک جا، با پرداخت ریالی، روی سرور ایران.')
  showFeaturedSection           Boolean  @default(true)
  showCategoriesSection         Boolean  @default(true)
  showBestSellersSection        Boolean  @default(true)
  showNewReleasesSection        Boolean  @default(true)
  showRecentActivitySection     Boolean  @default(true)
  featuredItemCount             Int      @default(6)
  bestSellersItemCount          Int      @default(8)
  newReleasesItemCount          Int      @default(8)
  updatedAt                     DateTime @updatedAt
  updatedByUserId               BigInt?
}
```

**Append-only enforcement** (DB triggers, same pattern as system `audit_log` and `ledger_entry`):

- `agents_purchase` — append-only (refunds set `status` and `refundedAt`, but the row is never edited otherwise; refund itself is a new row pattern... actually we keep `status` mutable here for simplicity since refunds should be rare. **Decision: not append-only. Status mutation is allowed for refunds, but tracked in audit log via `AGENTS_PURCHASE_REFUNDED`.** This is the documented exception.)
- `agents_run_event` — **append-only** (DB trigger blocks UPDATE/DELETE)

**Soft-delete:** only `agents_listing.deletedAt`. All other tables hard-keep history.

**FTS:** `agents_listing.searchVector` updated by Postgres trigger on insert/update of `titleFa, shortDescFa, longDescFaMd, slug`. Trigram index for ILIKE substring searches.

---

## API Surface

All endpoints under `/api/v1/agents/...`. Public endpoints `@Public()`; authenticated endpoints require JWT; admin/maker endpoints require permissions.

### Public (browse + buy)

| Method + Path          | Purpose                                                                             | Permission |
| ---------------------- | ----------------------------------------------------------------------------------- | ---------- |
| `GET /catalog`         | Paginated listings; filters: category, pricingType, freeOnly, minRating, q (search) | Public     |
| `GET /listings/:slug`  | Listing detail with screenshots, run packs, reviews                                 | Public     |
| `GET /categories`      | List active categories with counts                                                  | Public     |
| `GET /featured`        | Featured listings, ordered                                                          | Public     |
| `GET /best-sellers`    | Top by `totalUsers` (configurable count)                                            | Public     |
| `GET /new-releases`    | Latest published, configurable count                                                | Public     |
| `GET /recent-activity` | Last 50 anonymized "recent install/purchase" rows for the homepage widget           | Public     |
| `GET /settings/public` | Public-safe subset of agents_settings (hero copy, section flags)                    | Public     |

### Buyer (auth required)

| Method + Path                          | Purpose                                                                               | Permission                                |
| -------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------- |
| `GET /cart`                            | Current user's cart (or merged from localStorage payload)                             | JWT                                       |
| `POST /cart`                           | Add item; body: `{ listingId, runPackId? }`                                           | JWT, idempotent                           |
| `DELETE /cart/:cartItemId`             | Remove item                                                                           | JWT                                       |
| `POST /cart/merge`                     | Merge guest cart from localStorage into DB cart on login                              | JWT, idempotent                           |
| `POST /checkout`                       | Complete checkout — creates `agents_purchase` rows, grants run packs, decrements cart | JWT, idempotent                           |
| `GET /me/library`                      | Owned listings + per-listing remaining runs                                           | `agents:read:catalog` (every user has it) |
| `GET /me/library/:listingId/download`  | Download agent bundle (streams via system FileStore)                                  | `agents:download:owned` + ownership       |
| `POST /me/library/:listingId/review`   | Post a review (must own, max one per listing)                                         | `agents:review:owned` + ownership         |
| `PATCH /me/library/:listingId/review`  | Edit own review                                                                       | same                                      |
| `DELETE /me/library/:listingId/review` | Delete own review                                                                     | same                                      |

### Maker

| Method + Path                                      | Purpose                                                                      | Permission                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `POST /me/maker/listings`                          | Submit a new listing (status PENDING_REVIEW)                                 | `agents:create:listing`, idempotent                             |
| `GET /me/maker/listings`                           | List own listings, all statuses                                              | `agents:read:sales_own`                                         |
| `GET /me/maker/listings/:id`                       | Detail of own listing                                                        | same                                                            |
| `PATCH /me/maker/listings/:id`                     | Edit own listing — published listings re-enter PENDING_REVIEW after edit     | `agents:update:listing_own`                                     |
| `POST /me/maker/listings/:id/run-packs`            | Add a run pack                                                               | same                                                            |
| `PATCH /me/maker/listings/:id/run-packs/:packId`   | Edit pack                                                                    | same                                                            |
| `DELETE /me/maker/listings/:id/run-packs/:packId`  | Soft-disable pack (keeps historic purchases working)                         | same                                                            |
| `POST /me/maker/listings/:id/screenshots`          | Upload screenshot (multipart)                                                | same                                                            |
| `DELETE /me/maker/listings/:id/screenshots/:scrId` | Remove screenshot                                                            | same                                                            |
| `POST /me/maker/listings/:id/api-key/rotate`       | Generate (or rotate) the run-consumption API key. Returns plaintext ONCE.    | `agents:update:listing_own` + `@AdminOnly`-style confirm header |
| `GET /me/maker/sales`                              | Aggregated sales stats: totalRevenue, perListing breakdown, recent purchases | `agents:read:sales_own`                                         |

### Run consumption (called by maker's external service)

| Method + Path        | Purpose                                                                   | Auth                                                                                                |
| -------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `POST /runs/consume` | Decrement a buyer's run counter. Body: `{ listingSlug, userId, apiKey }`. | API key in `X-Agent-API-Key` header — NOT JWT. Maker provides this key in their own service config. |

Behavior:

1. Verify `apiKey` matches `agents_listing.apiKeyHash` for `listingSlug`. If not → 401, log `REFUSED_INVALID_KEY`.
2. Look up `agents_user_runs` for `(userId, listingId)`. If not found or `remainingRuns = 0` → 409 `INSUFFICIENT_RUNS`, log `REFUSED_INSUFFICIENT`.
3. Atomically decrement `remainingRuns`, increment `totalConsumed`, update `lastConsumedAt`. Insert `agents_run_event` row with `CONSUMED`.
4. Increment `agents_listing.totalRuns` (denormalized).
5. If `remainingRuns ≤ ceil(0.1 * lastPackSize)` and not yet notified, dispatch `AGENTS_RUNS_LOW`.
6. If `remainingRuns = 0`, dispatch `AGENTS_RUNS_DEPLETED`.
7. Return `200 { remainingRuns, totalConsumed }`.

Rate limit on this endpoint: stricter than default (1000/min/IP since legitimate maker services may burst, but log for abuse detection).

### Admin

| Method + Path                          | Purpose                                            | Permission                           |
| -------------------------------------- | -------------------------------------------------- | ------------------------------------ |
| `GET /admin/listings`                  | All listings, filterable by status                 | `agents:moderate:listing`            |
| `POST /admin/listings/:id/approve`     | PENDING_REVIEW → PUBLISHED                         | same + S6 confirm header             |
| `POST /admin/listings/:id/reject`      | PENDING_REVIEW → REJECTED with reason              | same + S6 confirm header             |
| `POST /admin/listings/:id/suspend`     | PUBLISHED → SUSPENDED with reason                  | same + S6 confirm header             |
| `POST /admin/listings/:id/unsuspend`   | SUSPENDED → PUBLISHED                              | same + S6 confirm header             |
| `POST /admin/listings/:id/feature`     | Pin to featured                                    | `agents:manage:featured`             |
| `DELETE /admin/listings/:id/feature`   | Unpin                                              | same                                 |
| `PATCH /admin/listings/featured/order` | Reorder featured list                              | same                                 |
| `GET /admin/categories`                | List                                               | `agents:manage:categories`           |
| `POST /admin/categories`               | Create                                             | same                                 |
| `PATCH /admin/categories/:id`          | Edit                                               | same                                 |
| `DELETE /admin/categories/:id`         | Soft-delete (only if no listings reference)        | same                                 |
| `GET /admin/sales`                     | All purchases, filter by date/status/listing/maker | `agents:read:sales_all`              |
| `POST /admin/sales/:purchaseId/refund` | Mark refund (system Phase 10E reuse)               | `agents:read:sales_all` + S6 confirm |
| `GET /admin/reviews`                   | All reviews                                        | `agents:moderate:listing`            |
| `POST /admin/reviews/:id/hide`         | Hide a review                                      | same + S6 confirm                    |
| `GET /admin/settings`                  | Read settings                                      | `agents:manage:settings`             |
| `PATCH /admin/settings`                | Update settings (commission, sections, hero copy)  | same + S6 confirm                    |

---

## Frontend Surface

### Public marketplace pages

```
/agents                          → main page (hero + featured + categories + best-sellers + new releases + recent activity)
/agents/category/[slug]          → category page with filter sidebar + grid
/agents/[slug]                   → listing detail page
/agents/search?q=...             → search results with filter sidebar
/agents/submit                   → maker submission flow (auth-gated)
```

### Account pages

```
/account/library                 → owned listings (with run counters for PER_RUN)
/account/library/[listingId]     → ownership detail + reviews + buy more runs CTA
/account/maker/listings          → maker's listings list (all statuses)
/account/maker/listings/new      → new listing form (alias of /agents/submit)
/account/maker/listings/[id]     → edit own listing
/account/maker/sales             → maker's sales dashboard
```

### Admin pages

```
/admin/agents/listings           → moderation queue + filters
/admin/agents/listings/[id]      → review detail with approve/reject actions
/admin/agents/categories         → CRUD
/admin/agents/featured           → drag-to-reorder featured list
/admin/agents/sales              → all purchases table + filters + export
/admin/agents/settings           → commission %, sections on/off, hero copy
```

### Cart pages (system-level addition, lives in `/cart`, not `/agents/cart` — modules can add cart items but cart UI is global)

```
/cart                            → cart contents (anonymous + authenticated)
/checkout                        → confirm + complete (no payment in v1)
/checkout/success/[purchaseId]   → post-purchase confirmation
```

**NOTE:** The cart UI itself is technically generalizable across modules. For the agents-only-marketplace v1, cart contains only `agents_listing` items. When templates marketplace ships, cart accepts both. We design the cart with a polymorphic line-item shape from day one, but only the agents adapter is built in this module.

---

## Phase Breakdown — 5 Phase Groups

### Phase Group 1 — Module Foundation (~6 phases, ~1,400 LOC)

| Phase           | Title                                                                                      | Model | ~LOC |
| --------------- | ------------------------------------------------------------------------------------------ | ----- | ---- |
| 1A              | Module scaffold + Prisma schema + append-only triggers                                     | 🔴    | 200  |
| 1B              | PlatformModule contract (permissions, audit, notifications, admin pages, payment purposes) | 🔴    | 200  |
| 1C              | Settings + categories seed + bootstrap                                                     | 🟢    | 180  |
| 1D              | Module registration in `modules.config.ts` + smoke test                                    | 🟢    | 120  |
| 1E              | FTS trigger + trigram indexes for catalog search                                           | 🔴    | 180  |
| 1F              | Polymorphic cart shape (`agents_cart_item` + future-proof discriminator field)             | 🟢    | 150  |
| **Test Gate 1** | Module loads, permissions seeded, categories visible, FTS works, cart table ready          | 🔴    | —    |

### Phase Group 2 — Public Marketplace (~7 phases, ~1,500 LOC)

| Phase           | Title                                                                               | Model | ~LOC |
| --------------- | ----------------------------------------------------------------------------------- | ----- | ---- |
| 2A              | `ListingsService` core (CRUD, status transitions, denormalized counters)            | 🔴    | 200  |
| 2B              | Catalog endpoint with filters + cursor pagination                                   | 🟢    | 200  |
| 2C              | Listing detail endpoint (full payload: screenshots, packs, reviews, maker info)     | 🔴    | 200  |
| 2D              | Featured / best-sellers / new-releases / recent-activity endpoints                  | 🟢    | 180  |
| 2E              | Public categories endpoint with counts                                              | 🟢    | 130  |
| 2F              | Search endpoint (FTS + filters)                                                     | 🔴    | 200  |
| 2G              | View tracking (lightweight, sampled to avoid DB pressure)                           | 🟢    | 130  |
| **Test Gate 2** | All public endpoints return correct data, search works, RTL Persian content correct | 🔴    | —    |

### Phase Group 3 — Cart, Checkout, Library (~6 phases, ~1,300 LOC)

| Phase           | Title                                                                                                                       | Model | ~LOC |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- | ----- | ---- |
| 3A              | `CartService` (add/remove/merge), guest localStorage shape, server merge endpoint                                           | 🔴    | 200  |
| 3B              | Checkout endpoint (creates `agents_purchase` rows; for PER_RUN, increments `agents_user_runs`; idempotent; no real payment) | 🔴    | 200  |
| 3C              | Library endpoints (owned + run counters)                                                                                    | 🟢    | 180  |
| 3D              | Download owned bundle (streams via system FileStore + ownership check)                                                      | 🔴    | 180  |
| 3E              | Run-consumption endpoint with API-key auth + atomic decrement + rate limit                                                  | 🔴    | 200  |
| 3F              | Reviews (post / edit / delete + hide-by-admin)                                                                              | 🟢    | 180  |
| **Test Gate 3** | Full purchase flow works for FREE, ONE_TIME, PER_RUN; runs decrement; reviews enforced one-per-listing                      | 🔴    | —    |

### Phase Group 4 — Maker Operations (~6 phases, ~1,400 LOC)

| Phase           | Title                                                                              | Model | ~LOC |
| --------------- | ---------------------------------------------------------------------------------- | ----- | ---- |
| 4A              | Listing submission endpoint (multi-step DTO, validation, file upload coordination) | 🔴    | 200  |
| 4B              | Listing edit (published → PENDING_REVIEW after edit)                               | 🔴    | 180  |
| 4C              | Run-pack management endpoints                                                      | 🟢    | 180  |
| 4D              | Screenshot management endpoints                                                    | 🟢    | 150  |
| 4E              | API-key generation + rotation (plaintext returned ONCE; sha256 stored)             | 🔴    | 200  |
| 4F              | Maker sales dashboard endpoint (aggregations)                                      | 🟢    | 180  |
| **Test Gate 4** | Maker can submit listing, edit, manage packs, rotate API key, see sales            | 🔴    | —    |

### Phase Group 5 — Admin Operations + Frontend (~9 phases, ~1,800 LOC)

This is the largest group because it covers **all frontend pages** (public + account + admin). UI work compresses LOC counts because shadcn/ui primitives carry weight.

| Phase           | Title                                                                                                                                                                                           | Model | ~LOC |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---- |
| 5A              | Admin endpoints: listings moderation (approve/reject/suspend)                                                                                                                                   | 🔴    | 200  |
| 5B              | Admin endpoints: categories CRUD + featured ordering + settings                                                                                                                                 | 🟢    | 200  |
| 5C              | Admin endpoints: sales view, refund delegation, reviews moderation                                                                                                                              | 🟢    | 180  |
| 5D              | Frontend: main marketplace page (`/agents`) — hero, sections, terminal-light visual language                                                                                                    | 🔴    | 200  |
| 5E              | Frontend: listing detail (`/agents/[slug]`) + cart-add interaction + review section                                                                                                             | 🔴    | 200  |
| 5F              | Frontend: category, search, submit pages                                                                                                                                                        | 🟢    | 200  |
| 5G              | Frontend: cart + checkout + library pages                                                                                                                                                       | 🔴    | 200  |
| 5H              | Frontend: maker dashboard (listings + sales)                                                                                                                                                    | 🟢    | 200  |
| 5I              | Frontend: admin pages (moderation queue, categories, featured, settings)                                                                                                                        | 🔴    | 220  |
| **Test Gate 5** | End-to-end: anonymous browse → register → install free → purchase one-time → buy run pack → consume run → review; maker submit → admin approve → published; admin moderate → all action audited | 🔴    | —    |

---

## Plan Aggregate

| Metric                   | Value                           |
| ------------------------ | ------------------------------- |
| Total phase groups       | 5                               |
| Total dev phases         | ~34                             |
| Total test gates         | 5                               |
| Total estimated LOC      | ~7,400                          |
| Estimated execution time | ~24 hours of Claude Code        |
| Estimated calendar time  | 3–4 sessions across 1.5–2 weeks |
| Sonnet phases            | ~50%                            |
| Opus phases              | ~50%                            |

The Opus ratio is high because: payment-adjacent flows (purchase, run consumption, refund), security-critical surfaces (API keys, ownership checks), and admin moderation require correctness over speed.

---

## What Goes Into Detail Files

| File                                | Contents                                                         | Status             |
| ----------------------------------- | ---------------------------------------------------------------- | ------------------ |
| `agents-module-plan.md` (this file) | Master skeleton, contract, schema, API surface, frontend surface | **Delivered now**  |
| `agents-module-phases-1-5.md`       | Executable expansion of all 5 phase groups                       | **Delivered next** |

---

## Open Decisions That Block Build

These do not block planning. They block execution start:

1. **Maker payout timing** — even though no real payment in v1, we still need a documented promise to makers. Recommend: "Earnings tracked from day one; payouts begin when payments go live, with a backlog payout for everything earned during the no-payment phase." This keeps makers motivated to seed the marketplace.
2. **Refund policy** — what's the buyer's right to refund? Recommend: free agents → no refund (already free); one-time purchases → 7-day no-questions-asked; per-run packs → refund only the unused portion. Decision needed before launch but not before build.
3. **Initial seed listings** — recommend the user (or the user's team) seeds 20–30 listings before launch so the catalog isn't empty. These can be the user's own agents or commissioned from trusted makers.
4. **Maker terms of service** — legal-grade Persian document covering commission, content rules, takedown rights. Out of plan scope; user provides.
5. **Run-consume API key documentation** — a public docs page at `/docs/maker-api` showing makers exactly how to integrate. Recommend: build during Phase 5 frontend work, reuse the website-plan's docs section pattern.

---

## What Modules Will Be Planned After This One

Once Agents Marketplace ships and stabilizes, the natural sequence is:

1. **Templates Marketplace** — schema is ~70% identical to agents (same cart, same review system, same maker flow). Estimated 60% effort vs agents because the foundation transfers.
2. **Tools & Docs** — different model (subscription-based), reuses payment + ledger but no marketplace mechanics.
3. **Builders Marketplace** — hardest, requires bidding + escrow + chat. Saved for last in marketplace ordering.
4. **DevOps + Security** — small lead-capture modules, a single combined plan.

---

## When Saeed Says "Let's Build"

The execution sequence after this plan + the executable companion are saved:

1. Confirm system layer is at Phase 16 complete and deployed
2. Begin Phase 1A of this module (`agents-module-phases-1-5.md` opens with the Phase 1A prompt)
3. Run phase-by-phase with test gates
4. After Test Gate 5 passes, Agents Marketplace is live

**My recommendation, sir: ship this before Tools & Docs.** Two reasons. First, the visual mockups you shared show the market is hungry for an agents marketplace specifically — the user expectation is set. Second, agents marketplace generates network effects (each new maker brings their audience), which Tools & Docs (a content product) does not. Tools & Docs is a complement to a hot marketplace; on its own it converts more slowly.
