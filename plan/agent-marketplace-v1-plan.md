# AI Agent Marketplace — V1 Development Plan

## Module Overview

**Module Name:** `agent-marketplace`
**Brand Name:** TBD (sir to confirm)
**Version:** 1.0.0
**Priority:** Wave 1 — first platform service of the AI Gold Rush venture
**Users:** Anonymous browsers (read-only), buyers, sellers, platform admins, support staff
**Scope:** MVP + V1 features (includes sandbox demo runtime)
**Builder:** Claude Code, orchestrated by sir
**Target Duration:** 3 weeks of focused build sessions

---

## Brand & UI Rules

All phases MUST follow these rules:

| Property      | Value                                                              |
| ------------- | ------------------------------------------------------------------ |
| Design System | shadcn/ui + Tailwind CSS                                           |
| Theme         | Light + Dark mode (system-aware)                                   |
| Direction     | LTR (English-first), i18n-ready for later locales                  |
| Language      | English (primary); structure ready for Persian/Arabic locale packs |
| Numbers       | Locale-aware via `Intl.NumberFormat`                               |
| Currency      | USD primary, multi-currency display via `Intl.NumberFormat`        |
| Dates         | ISO in API, locale-formatted in UI via `date-fns`                  |
| Mobile        | Mobile-first, fully responsive                                     |
| Icons         | Lucide React — no emoji in production UI                           |
| Typography    | Geist Sans + Geist Mono                                            |

**Color usage (Tailwind tokens, exposed as CSS variables):**

- Primary: configurable per brand (default `hsl(222 47% 11%)` neutral-dark)
- Accent: configurable
- Success: `hsl(142 71% 45%)`
- Warning: `hsl(38 92% 50%)`
- Destructive: `hsl(0 84% 60%)`
- Background, foreground, muted, border, ring — standard shadcn token set

---

## Architecture Snapshot

```
┌────────────────────────────────────────────────┐
│  apps/web — Next.js 15 (App Router, RSC)       │
│  apps/api — NestJS modular API                 │
│  apps/installer-cli — npm package              │
│  apps/sandbox-runner — Fly.io machine image    │
│  packages/db — Prisma schema + client          │
│  packages/types — Zod schemas, shared types    │
│  packages/ui — shadcn component library        │
│  packages/inference — AI provider abstraction  │
│  packages/config — eslint, tsconfig, tailwind  │
└────────────────────────────────────────────────┘
       │
       ├─ PostgreSQL (Neon)
       ├─ Redis (Upstash)
       ├─ Meilisearch (self-hosted or cloud)
       ├─ Cloudflare R2 (artifacts)
       ├─ Stripe Connect (payments + Connect Standard)
       ├─ Clerk (auth + roles)
       ├─ Pusher (real-time)
       ├─ Resend (transactional email)
       ├─ Fly.io Machines (sandbox runtime)
       └─ Sentry + PostHog + BetterStack (observability)
```

---

## Database Schema (high-level)

Detailed per-table schemas live in their respective phases. Top-level entities:

```
User ──┬── SellerProfile ──── StripeAccount
       │       │
       │       └── Agent ── AgentVersion ── Listing
       │                        │
       │                        ├── Review
       │                        ├── Bundle
       │                        └── SandboxConfig
       │
       └── Purchase ── License ── Installation ── InstallationLog
              │
              └── SupportTicket ── TicketMessage

Audit, Notification, Payout, Refund, RevocationList — cross-cutting tables
```

Every monetary value: integer cents + ISO 4217 currency code.
Every table: `created_at`, `updated_at`, `deleted_at` (soft delete), `id` UUID v7.
Every state-changing action writes an audit row.

---

## Permission Format

`{module}:{action}:{resource}` — e.g., `marketplace:approve:listing`, `seller:publish:agent`, `buyer:refund:purchase`.

**Default roles:**

- `guest` — read public listings only
- `member` — purchase, review, manage own purchases
- `seller` — all member rights + create/manage own agents and listings
- `support` — read all tickets, respond, escalate
- `moderator` — approve listings, handle disputes, suspend users
- `admin` — full platform control

Roles are additive. Stored in Clerk `publicMetadata.roles[]` and mirrored in `users.roles` for join queries.

---

## Phase Conventions

- **Phase format:** ~200 LOC max per phase. Larger work split into A, B, C.
- **Model assignment:**
  - 🟢 Sonnet — routine CRUD, scaffolding, UI, repetitive logic
  - 🔴 Opus — payment integration, security boundaries, license signing, sandbox isolation, dispute resolution, anything where a bug costs money or trust
- **Naming:** `{GROUP}-{NUMBER}{LETTER}` — e.g., `INFRA-1A`, `SELLER-3B`, `PAY-2A`
- **Test gate:** every phase group ends with a test phase. No moving to the next group with red tests.
- **CLAUDE.md:** every app/package gets a `CLAUDE.md` for Claude Code context continuity.
- **Definition of done per phase:** code compiles, types pass, tests pass for that scope, manually verified by sir for user-facing changes.

---

## Phase Groups Overview

| Group     | Code    | Purpose                                | Phases  | Est. LOC    | Model Mix |
| --------- | ------- | -------------------------------------- | ------- | ----------- | --------- |
| 0         | INFRA   | Monorepo, infra, baseline tooling      | 6       | 1,400       | 🟢        |
| 1         | AUTH    | Clerk, roles, RBAC middleware          | 5       | 1,000       | 🟢🔴      |
| 2         | SELLER  | Seller onboarding, Stripe Connect      | 7       | 1,800       | 🔴        |
| 3         | AGENT   | Agent CRUD, versioning, manifest       | 8       | 2,200       | 🟢🔴      |
| 4         | LISTING | Listing pages, search, browse          | 7       | 1,900       | 🟢        |
| 5         | UPLOAD  | Artifact upload, R2, virus scan        | 5       | 1,200       | 🔴        |
| 6         | PAY     | Stripe Checkout, webhooks, fees        | 7       | 1,800       | 🔴        |
| 7         | LICENSE | JWT licenses, validation, revocation   | 5       | 1,100       | 🔴        |
| 8         | INSTALL | CLI installer, install logging         | 6       | 1,400       | 🟢🔴      |
| 9         | BUYER   | Buyer dashboard, purchases             | 5       | 1,200       | 🟢        |
| 10        | REVIEW  | Reviews, ratings, moderation           | 4       | 900         | 🟢        |
| 11        | SUPPORT | Ticketing, SLA, escalation             | 6       | 1,500       | 🟢        |
| 12        | ADMIN   | Admin console, approvals, disputes     | 7       | 1,800       | 🟢🔴      |
| 13        | REFUND  | Refund window, abuse detection         | 4       | 900         | 🔴        |
| 14        | NOTIFY  | Email + in-app notifications           | 4       | 900         | 🟢        |
| 15        | SANDBOX | Fly.io ephemeral demo containers       | 6       | 1,600       | 🔴        |
| 16        | BUNDLE  | Bundles + subscriptions                | 5       | 1,200       | 🔴        |
| 17        | AFFIL   | Affiliate links, referral tracking     | 4       | 900         | 🟢        |
| 18        | CURATE  | Editorial categories, capability decl. | 4       | 800         | 🟢        |
| 19        | OBS     | Sentry, PostHog, BetterStack, dash     | 4       | 800         | 🟢        |
| 20        | SEED    | Seed data, fixtures, demo sellers      | 3       | 600         | 🟢        |
| 21        | LAUNCH  | Pre-launch hardening, runbook          | 5       | 1,000       | 🔴        |
| **Total** |         |                                        | **117** | **~26,900** |           |

**Estimated build time (Claude Code execution + sir review):** 70–90 hours of focused sessions.

---

## GROUP 0 — INFRA (Monorepo Foundation)

### INFRA-1A — Monorepo bootstrap 🟢

- Initialize Turborepo with pnpm workspaces.
- Create `apps/web`, `apps/api`, `packages/db`, `packages/types`, `packages/ui`, `packages/config`, `packages/inference`.
- Root `package.json`, `turbo.json`, `pnpm-workspace.yaml`, `.nvmrc`, `.gitignore`.

### INFRA-1B — Shared config packages 🟢

- `packages/config/eslint`, `packages/config/tsconfig` (base, nextjs, nestjs, react-library, node-library).
- `packages/config/tailwind` — base preset, design tokens.
- Husky + lint-staged + commitlint at root.

### INFRA-2A — Next.js scaffold (apps/web) 🟢

- Next.js 15 App Router, TypeScript strict, Tailwind, shadcn/ui init.
- Root layout with theme provider, font loading (Geist), error/not-found boundaries.
- Public landing route placeholder.

### INFRA-2B — NestJS scaffold (apps/api) 🟢

- NestJS with Fastify adapter, Helmet, compression, global validation pipe, global exception filter.
- Health check (`/health`), readiness (`/ready`), version (`/version`) endpoints.
- Pino logger with request-id, structured logs.

### INFRA-3A — Local dev environment 🟢

- `docker-compose.yml`: Postgres 16, Redis 7, Meilisearch, MailHog, MinIO (R2-compatible local).
- `.env.example` exhaustive, `.env.local` per-app via `dotenv-cli`.
- README with `make up`, `make down`, `make seed`, `make test`.

### INFRA-3B — CI/CD baseline 🟢

- GitHub Actions: lint, typecheck, unit test on PR.
- Build matrix: web + api + packages.
- Vercel preview deployments for web. Railway/Render for api preview.

**Test gate INFRA:** Both apps boot, health checks return 200, CI green on a no-op PR.

---

## GROUP 1 — AUTH (Identity & RBAC)

### AUTH-1A — Clerk integration (web) 🟢

- Clerk Next.js SDK, `<ClerkProvider>`, sign-in/sign-up routes, middleware for protected routes.
- User profile sync webhook → `users` table.

### AUTH-1B — Clerk JWT verification (api) 🔴

- NestJS auth guard verifying Clerk session JWT (JWKS).
- `@CurrentUser()` decorator, `@Public()` decorator for unauth routes.

### AUTH-2A — Users table + sync 🔴

- Prisma `users` model: `id`, `clerk_id`, `email`, `display_name`, `avatar_url`, `roles[]`, `metadata`.
- Webhook handlers: `user.created`, `user.updated`, `user.deleted` from Clerk.
- Idempotency: webhooks use `clerk_id` as upsert key, webhook event log table.

### AUTH-2B — RBAC middleware 🔴

- `@Roles('seller')` decorator, `@Permissions('marketplace:approve:listing')` decorator.
- Permission resolver: roles → permission set, cached in Redis (5 min TTL).
- 403 response shape standardized.

### AUTH-3 — Auth tests 🔴

- Integration tests: anonymous can read public, member cannot publish, seller can publish, admin can approve.
- Webhook signature verification test, replay attack rejection test.

**Test gate AUTH:** All role transitions covered, JWT tampering rejected, webhook replays rejected.

---

## GROUP 2 — SELLER (Onboarding + Stripe Connect)

### SELLER-1A — Seller profile model 🟢

- `seller_profiles` table: `user_id`, `display_name`, `bio`, `website`, `support_email`, `tax_country`, `created_at`, `verified_at`, `suspended_at`.
- Prisma model + repository.

### SELLER-1B — Become a seller flow (web) 🟢

- "/sell" landing page, terms acceptance, profile form.
- POST creates `seller_profile`, grants `seller` role via Clerk `publicMetadata` update.

### SELLER-2A — Stripe Connect onboarding init 🔴

- Create Stripe Connect Standard account on seller signup.
- Generate Account Link, redirect to Stripe-hosted onboarding.
- Store `stripe_account_id`, onboarding status.

### SELLER-2B — Stripe Connect onboarding return 🔴

- Return URL handler verifies `details_submitted`, `charges_enabled`, `payouts_enabled`.
- Updates `seller_profile.verified_at` only when all three are true.
- Refresh URL handler regenerates link if expired.

### SELLER-3A — Seller dashboard shell 🟢

- `/dashboard/seller` layout, sidebar with: Listings, Sales, Payouts, Reviews, Support, Settings.
- Empty states for each section.

### SELLER-3B — Seller dashboard data 🟢

- Sales summary widget (last 30 days), pending payouts, active listings count, average rating.
- API endpoints: `/api/seller/summary`, `/api/seller/payouts`.

### SELLER-4 — Seller tests 🔴

- E2E: signup → become seller → complete Stripe onboarding → dashboard loads with zero state.
- Stripe webhook `account.updated` flips `verified_at` correctly.

**Test gate SELLER:** Seller cannot list until `verified_at` is set. UI blocks listing creation gracefully.

---

## GROUP 3 — AGENT (Core Entity + Versioning)

### AGENT-1A — Agent + version schema 🟢

- `agents` table: `id`, `seller_id`, `slug`, `name`, `category`, `agent_type`, `created_at`, `archived_at`.
- `agent_versions` table: `id`, `agent_id`, `semver`, `manifest_json`, `changelog`, `artifact_url`, `published_at`, `deprecated_at`.

### AGENT-1B — Manifest schema (Zod) 🔴

- `packages/types/manifest.ts`: strict Zod schema for `manifest.json`.
- Required: `name`, `version`, `runtime` (`node`|`python`|`docker`|`prompt-bundle`), `entrypoint`, `capabilities[]`, `permissions[]`, `env_vars[]`, `install_script`, `min_platform_version`.
- Optional: `gpu_required`, `network_required`, `data_access[]`.

### AGENT-2A — Agent CRUD API 🟢

- `POST /api/seller/agents`, `PATCH /api/seller/agents/:id`, `DELETE /api/seller/agents/:id` (soft).
- Slug auto-generated from name, uniqueness enforced.
- Only seller of agent can mutate.

### AGENT-2B — Version CRUD API 🟢

- `POST /api/seller/agents/:id/versions` — uploads artifact ref, parses manifest, validates Zod.
- Version cannot be edited after publish, only deprecated.
- Latest published version computed via SQL view.

### AGENT-3A — Agent creation form (web) 🟢

- Multi-step form: basics → manifest upload → pricing → screenshots.
- React Hook Form + Zod resolver, progress saved to `localStorage` until submit.

### AGENT-3B — Agent edit + version publish UI 🟢

- Edit page for unpublished agents, version-publish modal with changelog editor.
- "What this agent does NOT do" required field on first version.

### AGENT-4A — Pricing model 🔴

- `listings` table: `agent_id`, `pricing_model` (`one_time`|`subscription_monthly`|`subscription_annual`), `amount_cents`, `currency`, `published_at`, `unpublished_at`, `approval_status`.
- Subscription pricing creates Stripe Product + Price on publish.

### AGENT-4B — Agent tests 🔴

- Manifest validation rejects malformed JSON, missing required fields, invalid runtimes.
- Version monotonicity: cannot publish v1.0.0 after v2.0.0.
- Slug collision returns 409.

**Test gate AGENT:** Seller can create agent, upload v1.0.0 manifest, set pricing. Listing exists in `pending_approval` state.

---

## GROUP 4 — LISTING (Browse + Search)

### LISTING-1A — Public listing detail page 🟢

- `/agents/[slug]` SSR page, ISR with 60s revalidate.
- Sections: hero, description (MDX), capabilities, screenshots, pricing, version history, reviews, install requirements.

### LISTING-1B — MDX renderer 🟢

- `next-mdx-remote` + `rehype-sanitize` whitelist (no `<script>`, no `on*` handlers).
- Custom components: code blocks (Shiki), callouts, comparison tables.

### LISTING-2A — Browse page 🟢

- `/agents` grid view, server-rendered with search params.
- Card component: name, seller, price, rating, install count, primary capability badge.

### LISTING-2B — Faceted filters 🟢

- Sidebar filters: category, price range, rating, agent type, runtime, free-tier availability.
- URL state via `nuqs` or `useSearchParams`, no client-side mutation of filter source of truth.

### LISTING-3A — Meilisearch integration 🟢

- Self-hosted Meilisearch, Docker image in compose.
- Index: `listings` with searchable: name, description, tags, capabilities. Filterable: category, price, rating, agent_type.
- Sync worker: BullMQ job on `listing.published`, `listing.updated`, `agent.archived`.

### LISTING-3B — Search UI 🟢

- Search bar in header, instant search via Meilisearch JS client (debounced 200ms).
- Highlighted matches, "no results" state with category suggestions.

### LISTING-4 — Listing tests 🟢

- SSR snapshot for sample listing, MDX XSS rejection, Meilisearch sync on publish event, filter URL serialization round-trip.

**Test gate LISTING:** Public can browse, search, filter. SEO meta tags correct (Open Graph, Twitter Card, JSON-LD `Product` schema).

---

## GROUP 5 — UPLOAD (Artifact Storage + Scan)

### UPLOAD-1A — R2 client + signed upload URLs 🔴

- AWS SDK v3 configured for R2 endpoint. Bucket: `agent-artifacts-prod`.
- `POST /api/seller/upload-url` returns presigned PUT URL (15 min TTL), max size 500 MB.
- Client uploads direct to R2, sends key back to API on success.

### UPLOAD-1B — Upload session tracking 🔴

- `upload_sessions` table: `seller_id`, `r2_key`, `size_bytes`, `mime_type`, `state` (`pending`|`scanning`|`clean`|`infected`|`failed`), `created_at`.
- Cleanup worker: delete `pending` sessions > 1 hour old.

### UPLOAD-2A — Virus scan worker 🔴

- BullMQ queue `artifact-scan`. Worker pulls object, scans with ClamAV containerized daemon.
- Updates `upload_sessions.state`. Infected → R2 delete + seller notification + audit log.

### UPLOAD-2B — Manifest extraction 🔴

- After clean scan, extract `manifest.json` from artifact (zip/tar/docker manifest).
- Validate against Zod schema. Failure → reject upload, notify seller with specific errors.

### UPLOAD-3 — Upload tests 🔴

- EICAR test file rejected. Oversized upload rejected at signed URL stage. Manifest mismatch rejected. Race condition: two uploads with same r2_key.

**Test gate UPLOAD:** Clean artifact reaches `clean` state with parsed manifest. Infected file deleted from R2 within 60s of detection.

---

## GROUP 6 — PAY (Stripe Checkout + Connect Fees)

### PAY-1A — Checkout session creation 🔴

- `POST /api/checkout/agent/:listing_id` creates Stripe Checkout Session.
- Mode: `payment` (one-time) or `subscription`. `application_fee_amount` = 15% of subtotal.
- `transfer_data.destination` = seller's Connect account.
- `metadata`: `buyer_id`, `listing_id`, `agent_version_id` (locks version at purchase time).

### PAY-1B — Idempotency keys 🔴

- All Checkout creation uses `Idempotency-Key` header derived from `{buyer_id}:{listing_id}:{nonce}` where nonce expires in 10 min.
- Prevents double-charge on rapid double-click.

### PAY-2A — Webhook handler — payment succeeded 🔴

- Endpoint `/api/webhooks/stripe`, signature verification mandatory.
- `checkout.session.completed` → create `Purchase`, trigger license issuance, send email.
- Idempotent via `stripe_event_id` unique index on `webhook_events` table.

### PAY-2B — Webhook handler — subscription events 🔴

- `customer.subscription.created`, `.updated`, `.deleted` → manage subscription license lifecycle.
- `invoice.payment_failed` → grace period 7 days, then revoke license.

### PAY-3A — Stripe Tax 🔴

- Enable `automatic_tax: { enabled: true }` on Checkout Session.
- Buyer enters tax-relevant address; Stripe calculates and collects.
- Tax remittance is Stripe's responsibility on platform-charge model.

### PAY-3B — Payout reconciliation 🔴

- Daily worker: pull Stripe payouts for connected accounts, mirror to `payouts` table.
- Seller dashboard reads from local mirror, links out to Stripe Express dashboard.

### PAY-4 — Payment tests 🔴

- Stripe test mode E2E: success, decline, 3DS, refund, webhook signature failure, replay attack, idempotency.

**Test gate PAY:** Successful purchase creates Purchase row, fires license issuance, seller payout pending. No double-charges possible.

---

## GROUP 7 — LICENSE (JWT Issuance + Validation)

### LICENSE-1A — Key pair management 🔴

- Ed25519 key pair generated, private key in env (rotated yearly).
- `JWKS` endpoint `/api/.well-known/jwks.json` exposes public key for offline verification.

### LICENSE-1B — License issuance 🔴

- On purchase webhook: create `licenses` row, sign JWT with payload `{license_id, buyer_id, agent_id, version_range, type, iat, exp, jti}`.
- Email JWT to buyer + show in dashboard. Never store JWT (only metadata + jti for revocation).

### LICENSE-2A — Validation endpoint 🔴

- `POST /api/licenses/verify` with `{token}`.
- Verify signature, check revocation list (Redis set), return `{valid, agent_id, version_range, expires_at}`.
- Rate-limited per IP: 60/min.

### LICENSE-2B — Revocation list 🔴

- `license_revocations` table + Redis set `licenses:revoked` (jti).
- Revoke triggers: refund, fraud, seller deletion, manual admin action.
- TTL on Redis entry = JWT exp + 24h buffer.

### LICENSE-3 — License tests 🔴

- Tampered JWT rejected. Revoked JWT rejected. Expired JWT rejected. Valid JWT cached and re-validated within 5min.

**Test gate LICENSE:** License JWT survives signature roundtrip, revocation propagates within 5s, JWKS endpoint serves correct public key.

---

## GROUP 8 — INSTALL (CLI Installer)

### INSTALL-1A — CLI scaffold 🟢

- `apps/installer-cli`, published as `@brand/install`. CLI framework: `commander` + `prompts`.
- Commands: `install <license-key>`, `update <agent-slug>`, `list`, `uninstall <agent-slug>`.

### INSTALL-1B — License resolution 🔴

- CLI calls `/api/licenses/verify`, fetches manifest + signed artifact URL.
- Local config in `~/.brand/installs.json` tracks installed agents, versions, paths.

### INSTALL-2A — Artifact fetch + extract 🔴

- Stream download with progress bar. SHA-256 verification against manifest hash.
- Extract to `~/.brand/agents/<agent-slug>/<version>/` with strict perms (700).

### INSTALL-2B — Install script execution 🔴

- Run seller's `install_script` in agent dir with restricted env.
- Capture stdout/stderr, stream to user, also POST to `/api/installations/log`.
- Exit non-zero → mark install failed, auto-create draft support ticket.

### INSTALL-3A — Installation reporting 🟢

- Every install/update/uninstall POSTs to `/api/installations` with `{license_id, agent_version_id, host_fingerprint, status, log_excerpt}`.
- Buyer dashboard shows install history per license.

### INSTALL-3B — CLI tests 🟢

- Mock API server + fixture artifacts. Happy path, hash mismatch, install script failure, network interruption resume.

**Test gate INSTALL:** Buyer can install a real test agent end-to-end on macOS + Linux. Installation log visible in dashboard.

---

## GROUP 9 — BUYER (Dashboard + Purchases)

### BUYER-1A — Buyer dashboard shell 🟢

- `/dashboard` (default for `member` role) — sidebar: Purchases, Licenses, Installs, Support, Settings.

### BUYER-1B — Purchases list 🟢

- Table: agent, seller, date, amount, status, license, actions (download license, view receipt, request refund, open ticket).
- Stripe-hosted receipt link.

### BUYER-2A — License detail page 🟢

- Per-license view: agent + version range covered, expiry, install command pre-filled with key, copy-to-clipboard.

### BUYER-2B — Install history 🟢

- Per-license install events, host fingerprints, success/failure, log excerpts.

### BUYER-3 — Buyer tests 🟢

- Cannot view another buyer's purchases. License copy-to-clipboard works.

**Test gate BUYER:** Full buyer journey: discover → purchase → license → install command works.

---

## GROUP 10 — REVIEW (Ratings + Moderation)

### REVIEW-1A — Review schema + API 🟢

- `reviews` table: `purchase_id` (unique — one review per purchase), `rating` 1-5, `title`, `body`, `created_at`, `edited_at`, `hidden_at`.
- POST allowed only by `purchase.buyer_id`, only after install success or 7 days post-purchase.

### REVIEW-1B — Review display 🟢

- Listing page: aggregate rating, distribution histogram, review list with pagination.
- Verified-purchase badge, seller-response thread (one response per review).

### REVIEW-2A — Moderation 🟢

- Flag review action (any logged-in user). `review_flags` table.
- Moderator queue in admin console. Hide → review hidden but kept for audit.

### REVIEW-2B — Review tests 🟢

- Cannot review without purchase. Cannot review twice. Edit window 14 days.

**Test gate REVIEW:** Reviews aggregate correctly, hidden reviews excluded from average.

---

## GROUP 11 — SUPPORT (Tickets + SLA)

### SUPPORT-1A — Ticket schema 🟢

- `support_tickets`: `id`, `purchase_id`, `opened_by`, `assigned_to` (seller initially), `status` (`open`|`seller_responded`|`escalated`|`resolved`|`closed`), `priority`, `subject`, `created_at`, `seller_first_response_at`, `escalated_at`, `resolved_at`.
- `ticket_messages`: `ticket_id`, `author_id`, `body` (MDX), `attachments[]`, `created_at`.

### SUPPORT-1B — Ticket creation 🟢

- Buyer can open ticket from purchase. Auto-fill agent + version + last install log.
- Seller notified via email + dashboard badge.

### SUPPORT-2A — SLA escalation worker 🟢

- BullMQ scheduled job every 15 min: tickets with `seller_first_response_at IS NULL` and `created_at > 48h ago` → set `escalated_at`, notify platform support.

### SUPPORT-2B — Ticket conversation UI 🟢

- Thread view, real-time updates via Pusher channel `ticket:{id}`.
- Internal notes (visible only to seller + platform), separate from buyer-visible messages.

### SUPPORT-3A — Resolution + reopen 🟢

- Mark resolved by seller or platform. Buyer auto-prompted to confirm, can reopen within 7 days.
- Auto-close after 7 days if buyer silent.

### SUPPORT-3B — Support tests 🟢

- SLA escalation fires at exactly 48h. Reopen within window works, beyond window blocked.

**Test gate SUPPORT:** Ticket lifecycle complete, SLA visible on buyer side, escalation works deterministically.

---

## GROUP 12 — ADMIN (Platform Console)

### ADMIN-1A — Admin layout 🟢

- `/admin` route, gated by `admin` or `moderator` role.
- Sidebar: Approvals, Disputes, Sellers, Buyers, Listings, Reviews, Tickets, Refunds, Audit Log.

### ADMIN-1B — Listing approval queue 🟢

- Pending listings table: seller, agent, version, submitted_at, manifest preview, install script preview.
- Actions: Approve, Reject (with reason), Request changes (with notes — sent to seller).

### ADMIN-2A — Dispute resolution console 🔴

- Pending disputes (refund requests beyond 7 days, ticket escalations).
- Three-pane view: buyer history, seller history, dispute facts.
- Decision actions: side with buyer (refund + license revoke), side with seller (close), partial (custom amount).

### ADMIN-2B — Audit log viewer 🟢

- All `audit_logs` rows filterable by actor, target, action, date range.
- Export CSV, link to related entities.

### ADMIN-3A — Seller management 🟢

- Suspend, ban, force-payout-hold. Suspension sets `seller_profile.suspended_at`, blocks new purchases on their listings.

### ADMIN-3B — Buyer management 🟢

- Refund-rate flag (>30% triggers warning badge). Ban from purchasing.

### ADMIN-4 — Admin tests 🔴

- Permission boundaries: moderator cannot ban seller, only admin can. All admin actions write audit logs.

**Test gate ADMIN:** Listing approval, dispute resolution, suspension all work end-to-end with audit trail.

---

## GROUP 13 — REFUND (Window + Abuse Detection)

### REFUND-1A — Refund request API 🔴

- `POST /api/purchases/:id/refund` allowed if `created_at > now() - 7 days` and no successful install logged.
- Auto-approve path: refund Stripe charge, revoke license, mark purchase refunded.

### REFUND-1B — Manual refund flow 🔴

- Outside auto-approve window → creates dispute in admin queue with buyer-provided reason.
- Seller notified, can preempt by issuing refund themselves.

### REFUND-2A — Abuse detection 🔴

- Daily worker: compute per-buyer 30-day refund rate. >30% → flag buyer in admin console.
- Repeat: >50% → auto-suspend (admin can override).

### REFUND-2B — Refund tests 🔴

- Auto-refund within window works. Refund rate calculation accurate. Suspended buyer cannot purchase.

**Test gate REFUND:** Auto-refund completes in <30s. Stripe refund + license revoke atomic from buyer perspective.

---

## GROUP 14 — NOTIFY (Email + In-App)

### NOTIFY-1A — Resend integration 🟢

- React Email templates: purchase confirmation, license delivery, refund processed, ticket reply, seller payout, seller new sale.
- Resend client wrapper with retry on transient errors.

### NOTIFY-1B — In-app notification center 🟢

- `notifications` table, bell icon in header, unread count.
- Pusher channel `user:{id}` for live push.

### NOTIFY-2A — Preferences 🟢

- Per-user notification settings: email yes/no per category, in-app yes/no.
- Unsubscribe links use signed token, no login required.

### NOTIFY-2B — Notify tests 🟢

- Email rendered correctly across categories. Unsubscribe token verified. Pusher channel scoping verified.

**Test gate NOTIFY:** Every transactional event triggers correct notification(s) per user prefs.

---

## GROUP 15 — SANDBOX (Live Demo Containers)

### SANDBOX-1A — Sandbox config schema 🔴

- `sandbox_configs` per agent_version: `image_ref`, `entrypoint`, `demo_dataset_url`, `env_template`, `network_mode` (`none`|`limited`).
- Seller declares at version publish; admin must approve sandbox config separately from listing.

### SANDBOX-1B — Fly.io machine API client 🔴

- Wrapper around Fly Machines API: create, start, stop, destroy machine.
- Region pinned, CPU 1 shared / 256 MB RAM default, configurable up to 2 CPU / 1 GB.

### SANDBOX-2A — Session orchestrator 🔴

- `POST /api/sandbox/sessions` creates session, provisions machine, returns WebSocket URL for terminal.
- Session TTL 15 min, single concurrent session per buyer per agent.
- Anonymous users: 1 session per IP per hour, must complete CAPTCHA.

### SANDBOX-2B — Session lifecycle worker 🔴

- BullMQ: scheduled destroy at TTL, cleanup orphaned machines on startup, cost cap circuit breaker (suspend new sessions if hourly cost > $X).

### SANDBOX-3A — WebSocket terminal UI 🔴

- xterm.js in `/agents/[slug]/demo`, connects via Pusher Channels or direct WS to api.
- Backend proxies to machine's exec endpoint with line-buffered streaming.

### SANDBOX-3B — Sandbox tests 🔴

- Session creation + destruction. TTL enforcement. Cost cap halts new sessions. Network isolation: `network_mode: none` cannot reach internet.

**Test gate SANDBOX:** Anonymous user runs demo of test agent, machine destroyed within 30s of TTL. No machines orphaned over 24h soak test.

---

## GROUP 16 — BUNDLE (Bundles + Subscriptions)

### BUNDLE-1A — Bundle schema 🔴

- `bundles`: `seller_id`, `name`, `description`, `bundled_listing_ids[]`, `discount_pct`, `pricing_model`.
- Bundle purchase issues N licenses (one per included agent), tracked via `bundle_purchases.purchase_ids[]`.

### BUNDLE-1B — Bundle UI 🟢

- Seller bundle creator (drag listings into bundle), buyer bundle detail page showing constituent agents + savings.

### BUNDLE-2A — Subscription license model 🔴

- License JWT for subscription includes `subscription_id`, `current_period_end`. Validation endpoint checks Stripe subscription status if cached value > 1 hour old.
- Auto-revoke on `customer.subscription.deleted` webhook.

### BUNDLE-2B — Subscription management UI 🟢

- Buyer can pause, cancel, resume subscriptions via Stripe Customer Portal (configured for self-service).

### BUNDLE-3 — Bundle tests 🔴

- Bundle purchase issues all licenses atomically (transaction). Subscription cancellation revokes license at period end, not immediately.

**Test gate BUNDLE:** Bundle purchase delivers all licenses. Subscription lifecycle correct.

---

## GROUP 17 — AFFIL (Referral Tracking)

### AFFIL-1A — Affiliate codes 🟢

- `affiliate_codes`: per user, unique slug. Append `?ref=<slug>` to any listing URL.
- Cookie set 30 days, attribution to last-touch on purchase.

### AFFIL-1B — Commission calculation 🟢

- 10% of platform fee on purchases attributed to affiliate. Tracked in `affiliate_earnings` table.
- Payout via Stripe Connect Express account (lightweight, since affiliates may not be sellers).

### AFFIL-2A — Affiliate dashboard 🟢

- Clicks, conversions, earnings, payout history. Marketing assets section (banners, copy).

### AFFIL-2B — Affiliate tests 🟢

- Cookie attribution correct, last-touch wins, self-referral blocked.

**Test gate AFFIL:** Affiliate link → purchase → commission accrued → payout possible.

---

## GROUP 18 — CURATE (Editorial + Capabilities)

### CURATE-1A — Editorial categories 🟢

- `editorial_categories`: `slug`, `name`, `description`, `featured_listing_ids[]`, `sort_order`.
- Admin manages via console. `/explore/[category]` pages curated content.

### CURATE-1B — Capability declarations 🟢

- Standardized capability vocabulary: `reads.filesystem`, `writes.filesystem`, `network.outbound`, `executes.shell`, `accesses.api.openai`, etc.
- Sellers select from controlled list at version publish; surfaced as permissions panel on listing page.

### CURATE-2A — Compatibility filters 🟢

- Listing filter UI: "works with Claude API", "runs on local Ollama", "GPU required", "no internet required".
- Derived from manifest declarations, not seller-claimed.

### CURATE-2B — Curate tests 🟢

- Editorial pages render, capability vocabulary enforced (free-text rejected), filters return correct set.

**Test gate CURATE:** Editorial content live, capability transparency works.

---

## GROUP 19 — OBS (Observability)

### OBS-1A — Sentry both apps 🟢

- Frontend + backend Sentry SDK. Custom tags: `seller_id`, `agent_id`, `flow`. Source maps uploaded in CI.

### OBS-1B — PostHog instrumentation 🟢

- Funnel events: `view_listing`, `start_checkout`, `complete_purchase`, `install_attempt`, `install_success`.
- Session replay on Pro tier (configurable).

### OBS-2A — BetterStack log shipping 🟢

- Pino transport to BetterStack, structured logs queryable. Uptime monitoring on `/health`, `/ready`.

### OBS-2B — Marketplace health dashboard 🟢

- Internal `/admin/health` page: GMV (24h, 7d, 30d), take rate, refund rate, install success rate, top sellers, top categories. Reads from PostgreSQL aggregates + cached.

**Test gate OBS:** All errors reach Sentry, funnel data populates in PostHog, dashboard reflects test data accurately.

---

## GROUP 20 — SEED (Demo Data)

### SEED-1 — Seed script 🟢

- `pnpm seed` creates: 5 demo sellers (Stripe test accounts), 20 demo agents across categories, 50 demo purchases, 100 reviews.
- Idempotent, safe to re-run.

### SEED-2 — Test agents 🟢

- 3 real working agents the team owns: a code reviewer, a data extractor, a PR summarizer. Each with valid manifest + install script + sandbox config.
- Used for E2E testing and as launch-day inventory.

### SEED-3 — Fixture management 🟢

- `tests/fixtures/` shared between unit + e2e. Factory functions for User, Seller, Agent, Listing, Purchase.

**Test gate SEED:** Fresh DB → seed → app fully functional with browseable, purchasable inventory.

---

## GROUP 21 — LAUNCH (Hardening + Runbook)

### LAUNCH-1A — Security review 🔴

- Manual checklist: every endpoint authn'd correctly, every role check present, no secret in repo, no SQL injection vectors, no SSRF in artifact fetch, no XSS in MDX.
- Run OWASP ZAP scan, fix criticals + highs.

### LAUNCH-1B — Load test 🔴

- k6 scripts: 100 concurrent browsers, 20 concurrent purchases, 10 concurrent installs.
- Identify bottlenecks (DB connection pool, Meilisearch RPS, Stripe rate limits).

### LAUNCH-2A — Backup + restore 🔴

- Neon point-in-time recovery configured + tested. R2 cross-region replication on. Weekly DB export to separate bucket.
- Documented restore drill executed once.

### LAUNCH-2B — Incident runbook 🔴

- Markdown runbook in repo: "Stripe webhook down", "DB at capacity", "R2 egress spike", "License JWKS rotation", "Sandbox cost runaway".
- Each: detection signal, immediate mitigation, root cause checklist.

### LAUNCH-3 — Pre-launch checklist 🔴

- All test gates green. Test purchases on real Stripe with $1 listings using a real card. Real install on a clean machine. Refund flow tested with real money. Email delivery to gmail/outlook/proton verified. DNS, SSL, status page live.

**Test gate LAUNCH:** Sir personally completes a full purchase + install + refund cycle on production with real card. No errors in Sentry for 24h soak.

---

## Cross-Cutting Phases (parallel to groups)

These run alongside main groups, not sequentially:

| Code     | Purpose                                                  | Trigger                                                       |
| -------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| INFER-\* | AI inference abstraction package buildout                | Needed by SUPPORT (auto-categorize), ADMIN (review summaries) |
| I18N-\*  | i18n scaffolding                                         | Defer until after launch unless multi-locale launch decided   |
| DOCS-\*  | Public docs site (`/docs`) for sellers + buyers          | Build during weeks 2-3 in parallel                            |
| LEGAL-\* | Terms of service, privacy policy, seller agreement, DMCA | Lawyer review required, sir to coordinate                     |

---

## CLAUDE.md Files Required

- `/CLAUDE.md` — root, monorepo conventions, commands
- `/apps/web/CLAUDE.md` — Next.js patterns, component conventions
- `/apps/api/CLAUDE.md` — NestJS module structure, auth patterns
- `/apps/installer-cli/CLAUDE.md` — CLI conventions
- `/packages/db/CLAUDE.md` — Prisma schema rules
- `/packages/types/CLAUDE.md` — shared schema rules
- `/packages/ui/CLAUDE.md` — component standards

---

## Estimated Timeline

| Week   | Groups                                                                            | Outcome                                |
| ------ | --------------------------------------------------------------------------------- | -------------------------------------- |
| Week 1 | INFRA, AUTH, SELLER, AGENT, LISTING                                               | Sellers can list, public can browse    |
| Week 2 | UPLOAD, PAY, LICENSE, INSTALL, BUYER, REVIEW                                      | Full purchase + install loop closed    |
| Week 3 | SUPPORT, ADMIN, REFUND, NOTIFY, SANDBOX, BUNDLE, AFFIL, CURATE, OBS, SEED, LAUNCH | Trust + V1 features + launch readiness |

Sandbox group is the highest schedule risk. If it slips, defer to week 4 and launch without — the V1 features are independent.

---

## Risks Specific to This Plan

1. **Stripe Connect onboarding friction** (SELLER-2A/B). Sellers will abandon during Stripe KYC. Mitigation: seller can save listing as draft before onboarding completes; only `published_at` requires verified seller.

2. **Sandbox runaway cost** (SANDBOX-2B). Single bug = $1000s/day in Fly compute. Cost cap circuit breaker + alerting threshold at $50/hr is non-negotiable.

3. **License JWT key rotation** (LICENSE-1A). Yearly rotation requires multi-key JWKS support from day one. Designing this in now is cheap; retrofitting is expensive.

4. **Webhook delivery failures** (PAY-2A/B). Stripe retries for 3 days, but webhook downtime > 3 days = lost purchases. Idempotent + persisted webhook event log is mandatory; replay tool in admin console.

5. **MDX XSS** (LISTING-1B). Seller-controlled content rendered to all visitors. `rehype-sanitize` whitelist must be airtight; explicit deny on `<script>`, `<iframe>`, `<object>`, `<embed>`, all `on*` attributes, `javascript:` URLs, `data:` URLs except images.
