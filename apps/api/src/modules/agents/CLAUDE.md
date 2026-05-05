# CLAUDE.md — modules/agents/

## Module purpose

Two-sided **marketplace for AI agents** at `/agents/*`. Buyers browse and
purchase Persian agents authored by makers; makers submit listings, manage
run packs, see sales, and rotate per-listing API keys used by their
external services to consume run counters.

Persian name: **بازارگاه ایجنت‌ها**. Module name: `agents`.

## Locked decisions (master plan §"Locked Decision Contract")

- **Theme:** light brand + terminal accents — `#ffffff`/`#f8fafc` surfaces,
  ink text, brand orange `#f97316`, JetBrains Mono only on `$` prompts and
  agent slugs. NO dark mode anywhere in this module.
- **Listing approval:** manual review — every listing transitions
  `PENDING_REVIEW → PUBLISHED` only via admin action.
- **Cart persistence:** hybrid — localStorage for guests, merged into the
  DB cart on login.
- **Platform commission:** 20% default — stored in `agents_settings`
  (admin-editable), applied at sale time and frozen on each
  `agents_purchase` row.
- **Run packs:** cumulative — buying a second pack adds to the existing
  remaining-run balance for that listing.

## Pricing types

`AgentsPricingType` is one of:

- `FREE` — install creates an `agents_purchase` with `amountToman = 0`,
  no counter, lifetime access.
- `ONE_TIME` — single flat fee, lifetime access.
- `PER_RUN` — buyer chooses one named run pack; `runs` are decremented by
  the maker via `POST /api/v1/agents/runs/consume`. Multiple pack
  purchases stack.

Subscription pricing is **out of scope** for this module — it lives in
Tools & Docs.

## Data ownership

The agents module owns these tables (prefix `agents_`):

- `agents_category`, `agents_listing`, `agents_screenshot`,
  `agents_run_pack`
- `agents_cart_item`
- `agents_purchase`, `agents_user_runs`, `agents_run_event`
- `agents_review`
- `agents_settings`

It **reads from** these system services (and only these): `PaymentsService`,
`NotificationsService`, `FilesService`, `AuditService`, `LedgerService`.
It **does not** import from any other module — cross-module communication
flows through the system event bus or core service calls.

## API surface

All public routes are mounted at `/api/v1/agents/...`. The detailed list
lives in `plan/agents-module-plan.md` "API Surface".

## Frontend route map

| Surface             | Routes                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public marketplace  | `/agents`, `/agents/category/[slug]`, `/agents/[slug]`, `/agents/search`, `/agents/submit`                                                                           |
| Account             | `/account/library`, `/account/library/[listingId]`, `/account/maker/listings`, `/account/maker/listings/new`, `/account/maker/listings/[id]`, `/account/maker/sales` |
| Admin               | `/admin/agents/listings`, `/admin/agents/listings/[id]`, `/admin/agents/categories`, `/admin/agents/featured`, `/admin/agents/sales`, `/admin/agents/settings`       |
| Cart (system-level) | `/cart`, `/checkout`, `/checkout/success/[purchaseId]`                                                                                                               |

## Append-only enforcement

`agents_run_event` is **append-only** — DB triggers
`agents_run_event_no_update` and `agents_run_event_no_delete` raise on
any UPDATE/DELETE attempt. `agents_purchase` is **intentionally mutable**
to support refund-status flips (`COMPLETED → REFUNDED` plus
`refundedAt`/`refundReason`); this is the documented exception, audited
through `AGENTS_PURCHASE_REFUNDED`.

## Verification (psql via `make db-shell`)

```sql
-- All agents_* tables exist
\dt agents_*

-- Append-only trigger fires
INSERT INTO agents_run_event ("userId", "listingId", outcome)
VALUES (1, 1, 'CONSUMED');
UPDATE agents_run_event SET outcome = 'CONSUMED' WHERE id = 1;
-- → ERROR: agents_run_event is append-only — UPDATE not permitted

DELETE FROM agents_run_event WHERE id = 1;
-- → ERROR: agents_run_event is append-only — DELETE not permitted

-- agents_purchase remains mutable (refund flow)
UPDATE agents_purchase SET status = 'REFUNDED' WHERE id = 1;
-- → succeeds (intentional)
```

## Full-text search & trigram indexes (Phase 1E)

The `agents_listing.searchVector` column (`tsvector`) is populated by the
`agents_listing_tsv_update` trigger on every INSERT and on UPDATE of
`titleFa`, `shortDescFa`, `longDescFaMd`, or `slug`. Persian has no
Postgres FTS dictionary, so the `simple` regconfig is used (raw lexemes,
no stemming) with weighted ranking:

| Weight | Source field                           |
| ------ | -------------------------------------- |
| A      | `titleFa`, `slug`                      |
| B      | `shortDescFa`                          |
| C      | `LEFT(longDescFaMd, 4000)` (truncated) |

Two index types support search:

- `agents_listing_search_vector_idx` — GIN on `searchVector` for
  `@@ plainto_tsquery('simple', q)` matches.
- `agents_listing_{title,slug,shortdesc}_trgm_idx` — GIN with
  `gin_trgm_ops` for ILIKE substring fallback when FTS returns < 10 rows.

### Verification queries

```sql
-- 1. Confirm extension + trigger are present
SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';
\dft agents_listing_search_vector_update
\d+ agents_listing  -- check Triggers and Indexes sections

-- 2. Insert a row; the trigger populates searchVector
INSERT INTO agents_listing (
  slug, "titleFa", "shortDescFa", "longDescFaMd",
  "categoryId", "makerUserId", "pricingType", status, "updatedAt"
) VALUES (
  'fts-test', 'تست جستجو', 'یک ایجنت نمونه', 'متن کامل',
  (SELECT id FROM agents_category WHERE slug = 'research'),
  (SELECT id FROM users LIMIT 1),
  'FREE', 'DRAFT', NOW()
);
SELECT slug, "searchVector" IS NOT NULL AS populated
FROM agents_listing WHERE slug = 'fts-test';

-- 3. FTS query with rank
SELECT id, slug, ts_rank("searchVector", plainto_tsquery('simple', 'تست')) AS rank
FROM agents_listing
WHERE "searchVector" @@ plainto_tsquery('simple', 'تست')
ORDER BY rank DESC;

-- 4. Trigram fallback (ILIKE) — verify index use
EXPLAIN SELECT id FROM agents_listing WHERE "titleFa" ILIKE '%تست%';
-- → expect "Bitmap Index Scan on agents_listing_title_trgm_idx"

-- 5. Cleanup
DELETE FROM agents_listing WHERE slug = 'fts-test';
```
