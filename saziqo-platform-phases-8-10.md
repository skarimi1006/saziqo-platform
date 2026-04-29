# سازیکو Platform — Phase Groups 8–10 (Lean MVP, Executable)

> Read alongside `saziqo-platform-system-plan.md`, `saziqo-platform-phases-1-4.md`, and `saziqo-platform-phases-5-7.md`.
> Phase Groups 8–10 add the money + communications layer.
> Per-phase rules and conventions identical to phases 1–7.

---

# Phase Group 8 — Notifications (in-app + SMS)

## Phase 8A: Notifications Table + Service

**Model: 🟢 Sonnet** | ~180 LOC

**Deliverables:**

- The `Notification` table from Phase 2B is reused. Verify columns: `id, userId, channel (IN_APP|EMAIL|SMS), type, payload JSON, readAt, createdAt`.
- `apps/api/src/core/notifications/notifications.module.ts`
- `apps/api/src/core/notifications/notifications.service.ts`:
  - `dispatch({ userId, type, payload, channels })` — orchestrator: for each channel, render template, deliver via appropriate adapter, persist `Notification` row
  - `markRead(notificationId, userId)` — sets `readAt = now`, ownership-checked
  - `markAllRead(userId)` — bulk update for user
  - `findUnreadForUser(userId, pagination)` — list for in-app dropdown
  - `findAllForUser(userId, pagination)` — full history
- Notification types catalog `apps/api/src/core/notifications/types.catalog.ts`:
  ```typescript
  export const NOTIFICATION_TYPES = {
    OTP_SENT: 'OTP_SENT', // SMS only
    PROFILE_COMPLETED: 'PROFILE_COMPLETED', // IN_APP
    SESSION_REVOKED: 'SESSION_REVOKED', // IN_APP
    IMPERSONATION_NOTICE: 'IMPERSONATION_NOTICE', // IN_APP — user notified after admin impersonated
    PAYMENT_SUCCEEDED: 'PAYMENT_SUCCEEDED', // IN_APP + SMS
    PAYMENT_FAILED: 'PAYMENT_FAILED', // IN_APP
    WALLET_CREDITED: 'WALLET_CREDITED', // IN_APP
    WALLET_DEBITED: 'WALLET_DEBITED', // IN_APP
    PAYOUT_REQUESTED: 'PAYOUT_REQUESTED', // IN_APP — admin sees
    PAYOUT_APPROVED: 'PAYOUT_APPROVED', // IN_APP — user sees
    PAYOUT_REJECTED: 'PAYOUT_REJECTED', // IN_APP — user sees
    // Module-specific types added later
  } as const;
  ```
- Per-channel async dispatch: in-app is synchronous DB write; SMS is await-on-send (no queue in MVP since BullMQ is cut)
- If a channel fails (SMS provider down), the IN_APP notification still persists; the failure is logged but does not throw to the caller. Caller decides whether to surface to user.

**Acceptance:**

- `dispatch({ userId, type: 'OTP_SENT', payload: { code }, channels: ['SMS'] })` → SMS sent, no Notification row (OTP not stored as in-app)
- `dispatch({ userId, type: 'PAYMENT_SUCCEEDED', payload: {...}, channels: ['IN_APP', 'SMS'] })` → Notification row written + SMS sent
- SMS failure → logged, IN_APP row still written
- `markRead`, `markAllRead`, `findUnreadForUser` all work with ownership checks

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, and SAZIQO_PLATFORM_PHASES_8_10.md
fully. Execute Phase 8A.

Build apps/api/src/core/notifications/:
- notifications.module.ts: imports SmsModule, EmailModule (placeholder
  from 8B), PrismaModule
- types.catalog.ts: NOTIFICATION_TYPES const as listed in plan
- notifications.service.ts:
  - dispatch({ userId, type, payload, channels: ('IN_APP' | 'SMS' |
    'EMAIL')[] }):
    For each channel:
    - IN_APP: render template, prisma.notification.create
    - SMS: render SMS template, smsService.send (catch errors, log,
      but persist nothing for SMS since OTP is special-cased)
    - EMAIL: render email template, emailService.send (placeholder
      console adapter from 8B)
    Return summary of dispatched channels and any failures
  - markRead(id, userId): ownership check, set readAt
  - markAllRead(userId): bulk update where userId matches and readAt is null
  - findUnreadForUser(userId, pagination): cursor-based, channel=IN_APP only
  - findAllForUser(userId, pagination): cursor-based, channel=IN_APP only
  - countUnread(userId): for badge UI

Special case for OTP: when type is OTP_SENT and channel is SMS, do NOT
write a Notification row (would store the code in DB). Treat OTP as
ephemeral SMS-only.

Unit tests:
- dispatch with mixed channels writes IN_APP rows but not for OTP
- SMS failure does not block IN_APP write
- markRead is idempotent
- countUnread returns correct count

Commit as "feat(phase-8A): add notifications service".
```

---

## Phase 8B: Email Abstraction + Console Adapter (real SMTP deferred)

**Model: 🟢 Sonnet** | ~150 LOC

**Deliverables:**

- `apps/api/src/core/email/email.module.ts`
- `apps/api/src/core/email/email-provider.interface.ts`:

  ```typescript
  export interface EmailProvider {
    name: string;
    send(input: EmailInput): Promise<{ messageId: string }>;
  }

  export interface EmailInput {
    to: string;
    subject: string;
    htmlBody?: string;
    textBody: string; // always required for fallback
    replyTo?: string;
  }
  ```

- `apps/api/src/core/email/providers/console.provider.ts` — writes formatted email to logger as `[EMAIL CONSOLE] To: {to} Subject: {subject}\n{textBody}`. Returns fake messageId.
- `apps/api/src/core/email/email.service.ts` — picks provider via `EMAIL_PROVIDER` env (default `console` in v1)
- `EMAIL_PROVIDER` accepts: `console` (v1 default), `smtp` (v1.5 — placeholder, throws `EMAIL_PROVIDER_NOT_CONFIGURED`)
- Persian email templates as TypeScript constants in `apps/api/src/core/email/templates.catalog.ts`:
  ```typescript
  export const EMAIL_TEMPLATES = {
    welcome: {
      subject: 'به سازیکو خوش آمدید',
      textBody: (vars: { firstName: string }) =>
        `سلام ${vars.firstName} عزیز،\n\nبه سازیکو خوش آمدید! ...`,
    },
    payment_succeeded: {
      subject: 'پرداخت شما تأیید شد',
      textBody: (vars: { amount: string; reference: string }) =>
        `پرداخت شما به مبلغ ${vars.amount} تومان با موفقیت تأیید شد. شماره پیگیری: ${vars.reference}`,
    },
    // ...
  };
  ```

**Acceptance:**

- `emailService.send({ to: 'user@example.com', subject: 'test', textBody: 'hi' })` → log captures email contents, returns fake messageId
- Switching `EMAIL_PROVIDER=smtp` → throws `EMAIL_PROVIDER_NOT_CONFIGURED` (deferred to v1.5)
- Templates render with variable substitution

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, and SAZIQO_PLATFORM_PHASES_8_10.md
fully. Execute Phase 8B.

Build apps/api/src/core/email/:
- email-provider.interface.ts: EmailProvider, EmailInput per plan
- providers/console.provider.ts: logs structured to nestjs-pino at info
  level with prefix [EMAIL CONSOLE], returns { messageId: 'console-{uuid}' }
- providers/smtp.provider.ts: STUB — constructor throws
  EMAIL_PROVIDER_NOT_CONFIGURED. CLAUDE: real SMTP integration in v1.5;
  for v1, only console adapter is used.
- email.service.ts: picks provider based on EMAIL_PROVIDER env (default
  'console'). Provides render(templateKey, vars) and send(input) methods.
- templates.catalog.ts: EMAIL_TEMPLATES const with at least: welcome,
  payment_succeeded, payment_failed, profile_completed, payout_approved.
  All Persian. textBody is mandatory; htmlBody is optional and may be
  added in v1.5.
- email.module.ts: provides EmailService

Add to .env.example: EMAIL_PROVIDER=console (note "smtp deferred to v1.5")

Add error code: EMAIL_PROVIDER_NOT_CONFIGURED.

Wire EmailService into NotificationsService for the EMAIL channel
(currently only IN_APP and SMS are used; EMAIL channel will mostly be
used by future module flows like welcome-email).

Unit tests:
- console.provider logs and returns
- email.service picks correct provider based on env
- template rendering substitutes variables correctly
- smtp.provider throws as designed

Commit as "feat(phase-8B): add email abstraction with console adapter
(real smtp deferred to v1.5)".
```

---

## Phase 8C: In-App Notifications Endpoints

**Model: 🟢 Sonnet** | ~180 LOC

**Deliverables:**

- `GET /api/v1/users/me/notifications` — JWT required, query: `unreadOnly?` (boolean, default false), `cursor?`, `limit?` (max 50)
- `GET /api/v1/users/me/notifications/count-unread` — returns `{ count }` for header badge
- `PATCH /api/v1/users/me/notifications/:id/read` — marks one as read (ownership check)
- `PATCH /api/v1/users/me/notifications/read-all` — marks all unread as read
- All endpoints `@RequirePermission('users:read:profile_self')` — already granted to default `user` role
- Cursor pagination by `id DESC`
- Response shape includes the rendered Persian text alongside the raw payload, so frontend doesn't need to know template logic

**Acceptance:**

- Logged-in user can list own notifications
- `count-unread` returns correct number
- Mark-read works on own notification only (others' → 403)
- Mark-all-read updates only current user's rows

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, and SAZIQO_PLATFORM_PHASES_8_10.md
fully. Execute Phase 8C.

Add to NotificationsService:
- renderForUser(notification): given a Notification row, returns
  { ...row, renderedText: <Persian rendered string> } using the IN_APP
  template catalog (Phase 8D introduces the catalog; for now use a
  placeholder default text per type).

Add NotificationsController (apps/api/src/core/notifications/
notifications.controller.ts):
- @Get('users/me/notifications') @RequirePermission('users:read:profile_self')
  Query: unreadOnly bool, cursor bigint, limit number (max 50)
- @Get('users/me/notifications/count-unread') same permission
- @Patch('users/me/notifications/:id/read') ownership via service
- @Patch('users/me/notifications/read-all') current user only
- @Audit({ action: 'NOTIFICATION_MARKED_READ', resource: 'notification' })
  on the read endpoint; do NOT audit list endpoints (too noisy)

Sanitize response: include id, type, payload, readAt, createdAt,
renderedText. Hide internal fields (channel, raw template metadata).

Integration tests:
- List own notifications
- Cannot read others' notifications via id
- Mark-all-read affects only caller's rows
- Pagination cursor works

Commit as "feat(phase-8C): add in-app notification endpoints".
```

---

## Phase 8D: Notification Templates (hardcoded Persian — no i18n in MVP)

**Model: 🟢 Sonnet** | ~130 LOC

**Deliverables:**

- `apps/api/src/core/notifications/templates.catalog.ts`:

  ```typescript
  export interface NotificationTemplate {
    inApp: { title: string; body: (vars: Record<string, unknown>) => string };
    sms?: (vars: Record<string, unknown>) => string;
    email?: { subject: string; textBody: (vars: Record<string, unknown>) => string };
  }

  export const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
    OTP_SENT: {
      sms: (v) => `کد تایید سازیکو: ${v.code}\nاین کد تا ۲ دقیقه معتبر است.`,
    },
    PROFILE_COMPLETED: {
      inApp: {
        title: 'پروفایل تکمیل شد',
        body: () => 'حساب شما کامل شد. اکنون می‌توانید از همه امکانات استفاده کنید.',
      },
    },
    SESSION_REVOKED: {
      inApp: {
        title: 'یکی از نشست‌های شما لغو شد',
        body: (v) => `نشست از دستگاه ${v.userAgent} لغو شد.`,
      },
    },
    IMPERSONATION_NOTICE: {
      inApp: {
        title: 'دسترسی پشتیبانی به حساب',
        body: (v) =>
          `پشتیبانی سازیکو در تاریخ ${v.startedAt} برای ${v.durationMinutes} دقیقه به حساب شما دسترسی داشت. دلیل: ${v.reason}`,
      },
    },
    PAYMENT_SUCCEEDED: {
      inApp: {
        title: 'پرداخت موفق',
        body: (v) => `پرداخت ${v.amount} تومان با موفقیت تأیید شد.`,
      },
      sms: (v) => `سازیکو: پرداخت ${v.amount} تومان تأیید شد. کد پیگیری: ${v.reference}`,
    },
    PAYMENT_FAILED: {
      inApp: {
        title: 'پرداخت ناموفق',
        body: (v) => `پرداخت ${v.amount} تومان ناموفق بود. لطفاً مجدداً تلاش کنید.`,
      },
    },
    WALLET_CREDITED: {
      inApp: {
        title: 'افزایش موجودی',
        body: (v) => `${v.amount} تومان به کیف پول شما واریز شد. موجودی فعلی: ${v.balance}`,
      },
    },
    WALLET_DEBITED: {
      inApp: {
        title: 'کاهش موجودی',
        body: (v) => `${v.amount} تومان از کیف پول شما برداشت شد.`,
      },
    },
    PAYOUT_REQUESTED: {
      inApp: {
        title: 'درخواست تسویه ثبت شد',
        body: (v) => `درخواست تسویه ${v.amount} تومان ثبت شد و در صف بررسی است.`,
      },
    },
    PAYOUT_APPROVED: {
      inApp: {
        title: 'تسویه تأیید شد',
        body: (v) => `تسویه ${v.amount} تومان تأیید شد.`,
      },
    },
    PAYOUT_REJECTED: {
      inApp: {
        title: 'تسویه رد شد',
        body: (v) => `درخواست تسویه ${v.amount} تومان رد شد. دلیل: ${v.reason}`,
      },
    },
  };
  ```

- `NotificationsService.dispatch` updated to look up template via `NOTIFICATION_TEMPLATES[type]`, render appropriate channels' templates with `payload` as vars
- If template missing for requested channel → log warning, skip that channel
- Persian numerals: a small helper `formatToman(amount: bigint): string` that converts BigInt toman to a Persian-formatted string (with thousand separators using `,`); kept simple — no full Persian numeral conversion in MVP (digits stay Latin in transactional messages for clarity)

**Acceptance:**

- Dispatching `PAYMENT_SUCCEEDED` with `{ amount: 50000n, reference: 'ABC123' }` → IN_APP row contains rendered text "پرداخت 50,000 تومان با موفقیت تأیید شد." and SMS sent with similar text
- Missing template for type → warning logged, no row written
- Variable substitution works for all listed templates

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, and SAZIQO_PLATFORM_PHASES_8_10.md
fully. Execute Phase 8D.

Create apps/api/src/core/notifications/templates.catalog.ts per the
plan. Implement all NOTIFICATION_TYPES from 8A with appropriate templates
where in-app/sms/email channels make sense.

Add helper apps/api/src/core/notifications/format.ts with:
- formatToman(amount: bigint): string — formats BigInt as Latin digits
  with thousand separators (e.g. 50000n → "50,000"). Persian numeral
  conversion not in MVP — clarity over locale.

Update NotificationsService.dispatch to:
1. Look up template via NOTIFICATION_TEMPLATES[type]; if missing, warn
   and skip
2. For each requested channel, check if template defines that channel;
   if not, warn and skip that channel
3. Render with provided payload as vars (call template function)
4. Persist IN_APP row with both raw payload and renderedTitle/renderedBody
   for the in-app dropdown (add columns title/body to Notification table?
   No — keep payload JSON and render on read in 8C's renderForUser
   helper. Confirm 8C uses these templates correctly now.)
5. Send SMS/EMAIL via respective adapters

Update Phase 8C's renderForUser to use these templates.

Replace placeholder logger.info from earlier phases with real
notificationsService.dispatch calls:
- AuthService.verifyOtp → no notification needed (OTP itself is the
  message)
- UsersService.completeProfile → dispatch PROFILE_COMPLETED IN_APP
- ImpersonationService.stop → dispatch IMPERSONATION_NOTICE IN_APP to
  target user with payload {startedAt, durationMinutes, reason}
- SessionsService.revokeOne (called by user from /me/sessions/:id) →
  dispatch SESSION_REVOKED IN_APP only if revocation is admin-initiated;
  user-initiated self-revocation does not notify

Integration tests:
- Dispatch each template type, verify rendering
- Missing channel for a type → warns, no failure
- Variable substitution works

Commit as "feat(phase-8D): add notification templates and wire real
notifications".
```

---

## Test Gate 8: Notifications Verification

**Model: 🟢 Sonnet**

- [ ] Profile completion → IN_APP notification appears in `/me/notifications`
- [ ] Admin impersonation → after stop, target user sees IMPERSONATION_NOTICE
- [ ] Mark-read works; mark-all-read works; ownership enforced
- [ ] `count-unread` returns correct count
- [ ] OTP SMS still works as before (no Notification row written)
- [ ] Email templates render via console adapter (logged contents match expected)
- [ ] Missing template type → warning, no crash
- [ ] All notification dispatches show up in audit log (via `@Audit()` on read endpoints)

---

# Phase Group 9 — Internal Ledger

## Phase 9A: Ledger Entries Table (append-only)

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** Money is non-negotiable. Append-only enforcement and accuracy errors are catastrophic.

**Deliverables:**

- `LedgerEntry` table from Phase 2B is reused. Verify columns match plan:
  - `id BIGINT PK`
  - `userId BIGINT FK NULL` — beneficiary user (nullable for system entries)
  - `walletId BIGINT FK NULL` — affected wallet (nullable for non-wallet entries)
  - `kind ENUM(DEBIT, CREDIT)` — direction from wallet's perspective
  - `amount BIGINT` — toman, always positive (sign expressed via kind)
  - `currency VARCHAR DEFAULT 'IRT'` — toman code, locked in v1
  - `reference VARCHAR(120)` — external reference (payment id, payout id, etc.)
  - `description VARCHAR(500)` — human-readable Persian
  - `metadata JSON` — extensible (links to source action, related ledger entries for paired entries, etc.)
  - `createdAt TIMESTAMP`
- Append-only enforcement via the same trigger pattern as audit log:
  - New migration `ledger_append_only` with `BEFORE UPDATE` and `BEFORE DELETE` triggers raising exceptions
- `Wallet` table from Phase 2B reused. Add migration if missing: `Wallet { id, userId UNIQUE FK, balance BIGINT DEFAULT 0, createdAt, updatedAt }`
- Documented invariant: **for any wallet, sum of CREDIT amounts minus sum of DEBIT amounts MUST equal balance.** Reconciliation job (in 9E) verifies this nightly.

**Acceptance:**

- Manual UPDATE on `ledger_entry` via psql → fails
- Manual DELETE → fails
- Wallet balance is never directly updated outside the ledger service (enforced by service-layer discipline + future static analysis)

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, and SAZIQO_PLATFORM_PHASES_8_10.md
fully. Execute Phase 9A.

Verify the LedgerEntry and Wallet tables from Phase 2B match the plan
schema exactly. If LedgerEntry is missing the metadata JSON column,
add migration to include it.

Create new Prisma migration "ledger_append_only" with:

CREATE OR REPLACE FUNCTION prevent_ledger_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entry table is append-only — % not permitted',
    TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_no_update
BEFORE UPDATE ON ledger_entry
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_modification();

CREATE TRIGGER ledger_no_delete
BEFORE DELETE ON ledger_entry
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_modification();

Apply migration. Verify via psql:
- INSERT works
- UPDATE fails with trigger error
- DELETE fails with trigger error

Add a CLAUDE.md inside src/core/ledger/ stating the invariant:
"Wallet.balance MUST equal sum(CREDIT.amount) - sum(DEBIT.amount) for
that wallet. Direct mutation of Wallet.balance outside the LedgerService
is FORBIDDEN. The reconciliation job (Phase 9E) verifies this nightly."

Commit as "feat(phase-9A): add append-only enforcement to ledger".
```

---

## Phase 9B: Ledger Service (debit, credit, balance, transfer atomicity)

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Core money primitive. Bug = lost or duplicated money.

**Deliverables:**

- `apps/api/src/core/ledger/ledger.module.ts`
- `apps/api/src/core/ledger/ledger.service.ts`:
  - `credit({ walletId, amount, reference, description, metadata? })` — adds CREDIT entry, increments wallet balance, atomic via Prisma `$transaction` + row lock (`SELECT ... FOR UPDATE`)
  - `debit({ walletId, amount, reference, description, metadata? })` — adds DEBIT entry, decrements wallet balance, **rejects if insufficient balance** (throws `INSUFFICIENT_FUNDS`)
  - `transfer({ fromWalletId, toWalletId, amount, reference, description, metadata? })` — atomic: debit fromWallet + credit toWallet in single transaction; both ledger entries created with cross-references in metadata
  - `getBalance(walletId)` — direct read of `Wallet.balance` (cheap)
  - `verifyBalance(walletId)` — recomputes from ledger sum and compares to stored balance; throws `BALANCE_MISMATCH` if drift detected (used by reconciliation job)
  - `findEntriesForWallet(walletId, pagination)` — paginated history
- All amounts are `BIGINT` (toman); rejects negative or zero
- Row locking prevents race conditions when two concurrent debits hit the same wallet

**Acceptance:**

- Concurrent debits on same wallet are serialized (no negative balance)
- Transfer is atomic (both legs commit or both roll back)
- Balance after operations equals sum of ledger entries
- `verifyBalance` detects manual tampering (manual UPDATE on Wallet.balance via psql, then verifyBalance throws)
- `INSUFFICIENT_FUNDS` thrown when debit > balance

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, and SAZIQO_PLATFORM_PHASES_8_10.md
fully. Execute Phase 9B.

Build apps/api/src/core/ledger/:
- ledger.module.ts
- ledger.service.ts implementing the methods listed in the plan

Implementation:
- All write methods use prisma.$transaction:
  1. SELECT ... FOR UPDATE on the affected wallet row(s) to prevent
     concurrent races
  2. Validate amount > 0 (reject zero and negative — ZodPipe earlier
     should catch but defense in depth)
  3. For debit: ensure newBalance = currentBalance - amount >= 0; else
     throw INSUFFICIENT_FUNDS
  4. INSERT LedgerEntry with appropriate kind, amount, walletId,
     reference, description, metadata
  5. UPDATE Wallet SET balance = newBalance WHERE id = walletId
  6. Commit transaction

- transfer: in single $transaction, lock both wallets in deterministic
  order (lowest id first, prevents deadlock), perform debit then credit,
  store cross-reference (each entry's metadata includes the other entry's
  id) — but since we don't know id-2 until after insert, two-pass:
  insert both with metadata.peerEntryId = null, then UPDATE metadata
  via raw SQL appended? CLAUDE: append-only triggers reject UPDATE.
  Solution: do the inserts in order (debit, then credit), include
  fromWalletId/toWalletId in metadata of each entry. The cross-reference
  is implicit via reference field which is the same for both entries.

- verifyBalance(walletId):
  - Compute SUM(CASE WHEN kind=CREDIT THEN amount ELSE -amount END)
    over LedgerEntry for walletId
  - Compare to Wallet.balance
  - If different, throw BALANCE_MISMATCH (used by reconciliation only)

Add error codes: INSUFFICIENT_FUNDS, BALANCE_MISMATCH.

Unit tests:
- Concurrent debits serialize correctly (use sequential awaits with
  artificial delay to simulate)
- Transfer atomic (force credit to fail by mocking, debit must roll back)
- INSUFFICIENT_FUNDS rejected
- verifyBalance detects manual tampering

Integration test with raw SQL: insert ledger entries directly, then
manually corrupt Wallet.balance, run verifyBalance, expect BALANCE_MISMATCH.

Commit as "feat(phase-9B): add ledger service with transactional debit,
credit, transfer".
```

---

## Phase 9C: Wallet Abstraction (per-user balance)

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Wallet creation timing and ownership errors compound into the entire money model.

**Deliverables:**

- `apps/api/src/core/wallets/wallets.module.ts`
- `apps/api/src/core/wallets/wallets.service.ts`:
  - `findOrCreateForUser(userId)` — idempotent, ensures every user has a wallet (called lazily on first money-affecting action and explicitly on profile completion)
  - `findByUserId(userId)` — read with ownership check
  - `findByUserIdForAdmin(userId)` — admin variant with no ownership check
- `GET /api/v1/users/me/wallet` — JWT, returns balance + recent ledger entries (last 10)
- `GET /api/v1/users/me/wallet/entries` — paginated full history of user's own ledger entries
- `GET /api/v1/admin/users/:userId/wallet` — admin view with full entry history; `@RequirePermission('admin:read:users')`
- Update `UsersService.completeProfile` to call `walletsService.findOrCreateForUser(userId)` after status flip — ensures every active user has a wallet from day one
- After every CREDIT or DEBIT, dispatch `WALLET_CREDITED` or `WALLET_DEBITED` notification (in-app only — SMS would be too noisy in MVP)

**Acceptance:**

- Profile completion creates wallet
- `findOrCreateForUser` is idempotent (called twice returns same wallet)
- Self endpoints work for owner; 403 for others
- Admin endpoint works with permission
- Wallet credit/debit triggers in-app notification

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, and SAZIQO_PLATFORM_PHASES_8_10.md
fully. Execute Phase 9C.

Build apps/api/src/core/wallets/:
- wallets.module.ts: imports PrismaModule, NotificationsModule
- wallets.service.ts:
  - findOrCreateForUser(userId): use prisma.wallet.upsert with where
    userId unique. Idempotent.
  - findByUserId(userId): returns wallet, throws NOT_FOUND if missing
  - findByUserIdForAdmin(userId): same but without ownership semantic

Add WalletsController:
- @Get('users/me/wallet') @RequirePermission('users:read:profile_self')
  Returns { balance, recentEntries: last 10 }
- @Get('users/me/wallet/entries') @RequirePermission(
  'users:read:profile_self')
  Cursor-based pagination, returns { items, nextCursor, hasMore }
- @Get('admin/users/:userId/wallet') @RequirePermission('admin:read:users')
  Admin variant with full data

Update UsersService.completeProfile: after setting status=ACTIVE, call
walletsService.findOrCreateForUser(userId) within the same transaction
or right after.

Hook ledger events to notifications: in LedgerService.credit and .debit,
after successful commit, call notificationsService.dispatch with type
WALLET_CREDITED or WALLET_DEBITED, payload includes amount and new
balance, channel IN_APP only.

CLAUDE: avoid notification storms — if a transfer triggers credit and
debit on different wallets, both users get notifications, which is correct.
But if internal-system entries (no userId on ledger row) → skip notification.

Sanitization: ledger entry response excludes metadata.peerEntryId and
internal-only fields; description is shown verbatim.

Integration tests:
- Profile completion creates wallet
- findOrCreateForUser idempotent
- /users/me/wallet returns balance and entries
- /admin/users/:id/wallet works for admin, 403 for regular
- After credit, user receives WALLET_CREDITED notification

Commit as "feat(phase-9C): add wallet abstraction with notifications".
```

---

## Phase 9D: Payout Queue + Manual Approval Workflow

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Payouts move real money out of the platform. Approval workflow gone wrong = financial loss + legal exposure.

**Deliverables:**

- New table via migration:
  ```prisma
  model PayoutRequest {
    id              BigInt   @id @default(autoincrement())
    userId          BigInt
    walletId        BigInt
    amount          BigInt
    bankAccount     String   @db.VarChar(34)  // IBAN (شبا) starts with IR
    accountHolder   String   @db.VarChar(200)
    status          PayoutStatus @default(PENDING)
    submittedAt     DateTime @default(now())
    reviewedByUserId BigInt?
    reviewedAt      DateTime?
    rejectionReason String?  @db.VarChar(500)
    paidAt          DateTime?
    paymentReference String? @db.VarChar(120)  // bank transfer reference after manual payment
    @@index([userId])
    @@index([status])
    @@index([submittedAt])
  }
  enum PayoutStatus { PENDING APPROVED REJECTED PAID CANCELLED }
  ```
- `apps/api/src/core/payouts/payouts.service.ts`:
  - `request({ userId, amount, bankAccount, accountHolder })` — validates IBAN format (Iranian شبا: `IR` + 24 digits + checksum), validates wallet has sufficient balance, **places a HOLD on the wallet via a debit ledger entry** with description "Payout pending review", status `PENDING`
  - `approve(payoutId, reviewerUserId)` — status transitions PENDING → APPROVED; ledger already debited from request step
  - `reject(payoutId, reviewerUserId, reason)` — status PENDING → REJECTED; **credits the wallet back** to release the hold
  - `markPaid(payoutId, reviewerUserId, paymentReference)` — status APPROVED → PAID; sets `paidAt`; this is when ops has manually transferred funds via bank
  - `cancel(payoutId, userId)` — user-initiated cancellation while PENDING; credits the wallet back; only if status PENDING
- All status-changing methods use Prisma transactions and emit appropriate notifications:
  - `request` → `PAYOUT_REQUESTED` IN_APP for the user
  - `approve` → `PAYOUT_APPROVED` IN_APP for the user
  - `reject` → `PAYOUT_REJECTED` IN_APP for the user with reason
  - `markPaid` → `PAYOUT_PAID` IN_APP for the user (add type to catalog)
  - `cancel` → silent (user knows, they did it)

**Acceptance:**

- User requests payout for 100,000 toman with valid IBAN → ledger debited, status PENDING, balance reduced
- Invalid IBAN → 400
- Insufficient balance → 400 `INSUFFICIENT_FUNDS`
- Admin rejects → wallet credited back, status REJECTED, user notified
- Admin approves → status APPROVED (no ledger change — already debited)
- Admin marks paid → status PAID
- User cancels PENDING → wallet credited back, status CANCELLED
- User cannot cancel APPROVED/PAID

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, and SAZIQO_PLATFORM_PHASES_8_10.md
fully. Execute Phase 9D.

Add Prisma migration for PayoutRequest table per the plan schema.

Add to packages/persian-utils:
- src/iban.ts: isValidIranianIban(input: string): boolean
  Iranian IBAN format: "IR" + 2 check digits + 22 numeric digits = 26 chars
  Validate: starts with "IR", length 26, remaining 24 chars are digits.
  Validate ISO 13616 checksum (mod-97 algorithm).
  Reject all-zero and obvious invalids.

Build apps/api/src/core/payouts/:
- payouts.module.ts: imports LedgerModule, WalletsModule, NotificationsModule
- payouts.service.ts: implements all methods per plan

Add type to NOTIFICATION_TYPES catalog: PAYOUT_PAID. Add template to
NOTIFICATION_TEMPLATES with appropriate Persian message.

Implementation:
- request: validate IBAN, validate amount > 0, find wallet, atomically
  debit (description "Payout pending review", reference "payout:pending"
  initially, metadata { payoutRequestId: <new id> after insert }) and
  insert PayoutRequest row. Use $transaction.
- approve: $transaction, status PENDING → APPROVED, set reviewedByUserId,
  reviewedAt
- reject: $transaction, status PENDING → REJECTED, set reviewedByUserId,
  reviewedAt, rejectionReason; credit wallet back with description
  "Payout rejected — refund", reference "payout:rejected:{id}"
- markPaid: $transaction, status APPROVED → PAID, set paidAt,
  paymentReference; no ledger change (already debited at request time)
- cancel: $transaction, only if status=PENDING and userId matches caller;
  status PENDING → CANCELLED, credit wallet back

Add error codes: INVALID_IBAN, PAYOUT_NOT_PENDING, PAYOUT_NOT_APPROVED.

Add PayoutsController:
- @Post('users/me/payouts') @Audit({ action: 'PAYOUT_REQUESTED',
  resource: 'payout' }) — body: { amount, bankAccount, accountHolder }
- @Get('users/me/payouts') — own payouts, paginated
- @Patch('users/me/payouts/:id/cancel') — only PENDING

- @Get('admin/payouts') @RequirePermission('admin:read:payouts')
  — query: status, userId, dateFrom, dateTo, cursor, limit
- @Patch('admin/payouts/:id/approve') @RequirePermission(
  'admin:approve:payout') @AdminOnly({ confirmHeader: true })
  @Audit({ action: 'PAYOUT_APPROVED', resource: 'payout',
  resourceIdParam: 'id' })
- @Patch('admin/payouts/:id/reject') same permission +
  @AdminOnly({ confirmHeader: true }) — body: { reason }
- @Patch('admin/payouts/:id/mark-paid') @RequirePermission(
  'admin:approve:payout') @AdminOnly({ confirmHeader: true }) — body:
  { paymentReference }

Notifications: dispatch PAYOUT_REQUESTED on request (to user), PAYOUT_APPROVED
on approve, PAYOUT_REJECTED on reject (with reason), PAYOUT_PAID on
markPaid, no notification on user-cancel.

Integration tests:
- Full flow: request → admin approve → admin markPaid
- Rejection flow: request → admin reject → wallet credited back
- Cancel flow: request → user cancel → wallet credited back
- Invalid IBAN rejected
- Insufficient balance rejected
- Cannot cancel APPROVED

Commit as "feat(phase-9D): add payout queue with manual approval".
```

---

## Phase 9E: Reconciliation Report Endpoint

**Model: 🟢 Sonnet** | ~150 LOC

**Deliverables:**

- `GET /api/v1/admin/ledger/reconciliation` — `@RequirePermission('admin:read:audit_log')`:
  - Computes per-wallet: stored balance vs ledger-summed balance
  - Returns `{ data: [{ walletId, userId, storedBalance, computedBalance, drift, status: 'OK'|'DRIFT' }], summary: { totalWallets, walletsWithDrift, totalStoredBalance, totalComputedBalance } }`
  - Pagination NOT used here; report is full sweep (run-on-demand by admin or future cron)
  - Caps result at 10,000 wallets in v1 (returns warning meta if more exist; defer batched job to v1.5)
- `GET /api/v1/admin/ledger/aggregates` — daily totals by ledger.kind for last N days, defaults to 30
  - Returns `{ data: [{ date, credits, debits, netFlow, entryCount }] }`
  - Useful for ops dashboard

**Acceptance:**

- Healthy DB → all wallets show `OK`
- Manual tampering of `Wallet.balance` via psql → reconciliation shows `DRIFT` for that wallet with computed correction
- Aggregates returns 30 days of data with correct sums

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, and SAZIQO_PLATFORM_PHASES_8_10.md
fully. Execute Phase 9E.

Add to LedgerService:
- reconciliationReport({ limit = 10000 }): runs raw SQL aggregation:
  SELECT
    w.id as wallet_id,
    w.user_id,
    w.balance as stored_balance,
    COALESCE(SUM(CASE WHEN le.kind = 'CREDIT' THEN le.amount
                      WHEN le.kind = 'DEBIT' THEN -le.amount END), 0)
      as computed_balance
  FROM wallet w
  LEFT JOIN ledger_entry le ON le.wallet_id = w.id
  GROUP BY w.id
  LIMIT $1
  Then in TS: compute drift = stored - computed, status = drift==0 ? OK : DRIFT
  Return { items, summary }

- aggregates({ days = 30 }): daily totals
  SELECT
    DATE_TRUNC('day', created_at) as date,
    SUM(CASE WHEN kind = 'CREDIT' THEN amount ELSE 0 END) as credits,
    SUM(CASE WHEN kind = 'DEBIT' THEN amount ELSE 0 END) as debits,
    COUNT(*) as entry_count
  FROM ledger_entry
  WHERE created_at >= NOW() - INTERVAL '$1 days'
  GROUP BY DATE_TRUNC('day', created_at)
  ORDER BY date DESC

Add LedgerAdminController (or extend existing):
- @Get('admin/ledger/reconciliation') @RequirePermission(
  'admin:read:audit_log')
- @Get('admin/ledger/aggregates') same permission, query: days

Sanitize: response includes wallet_id and user_id only, no PII.

Integration tests:
- Healthy DB: all OK
- Tamper Wallet.balance directly via prisma.$executeRaw, run reconciliation,
  confirm DRIFT status for that wallet
- Aggregates returns last N days

Commit as "feat(phase-9E): add ledger reconciliation and aggregates".
```

---

## Test Gate 9: Ledger Verification

**Model: 🔴 Opus**

- [ ] Append-only triggers prevent UPDATE/DELETE on `ledger_entry`
- [ ] Profile completion creates wallet
- [ ] Concurrent debits serialize (no negative balance)
- [ ] Transfer is atomic (test via mocked failure)
- [ ] `verifyBalance` detects tampering
- [ ] Payout request: full flow (request → approve → mark-paid)
- [ ] Payout reject: wallet credited back
- [ ] Payout cancel: wallet credited back
- [ ] Invalid IBAN rejected
- [ ] Insufficient balance rejected
- [ ] Reconciliation report: all OK on clean DB
- [ ] Reconciliation report: shows DRIFT after manual `Wallet.balance` corruption
- [ ] All payout transitions emit appropriate notifications
- [ ] All payout transitions write audit entries

---

# Phase Group 10 — Payments (ZarinPal)

## Phase 10A: PaymentProvider Interface + ZarinPal Adapter Scaffold

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** Payment integration is high-stakes. Bug in callback handler = lost transactions or fraud.

**Deliverables:**

- `apps/api/src/core/payments/payment-provider.interface.ts`:

  ```typescript
  export interface PaymentProvider {
    name: string;
    initiate(input: InitiateInput): Promise<InitiateOutput>;
    verify(input: VerifyInput): Promise<VerifyOutput>;
    refund(input: RefundInput): Promise<RefundOutput>;
  }

  export interface InitiateInput {
    amount: bigint; // toman
    description: string; // shown on gateway page
    callbackUrl: string; // our public URL to receive callback
    referenceId: string; // our internal payment id
    userMobile?: string; // pre-fill phone on gateway
    userEmail?: string;
  }

  export interface InitiateOutput {
    redirectUrl: string; // user is redirected here
    providerReference: string; // ZarinPal authority code
  }

  export interface VerifyInput {
    providerReference: string;
    expectedAmount: bigint;
  }

  export interface VerifyOutput {
    verified: boolean;
    referenceCode?: string; // bank reference (for receipt)
    cardPan?: string; // masked PAN (last 4)
    failureReason?: string;
  }

  export interface RefundInput {
    providerReference: string;
    amount: bigint;
    reason: string;
  }

  export interface RefundOutput {
    refunded: boolean;
    failureReason?: string;
  }
  ```

- `apps/api/src/core/payments/providers/zarinpal.provider.ts`:
  - Calls ZarinPal v4 API (`https://api.zarinpal.com/pg/v4/payment/request.json`, `verify.json`)
  - Authentication via `merchant_id` (UUID format) from env `ZARINPAL_MERCHANT_ID`
  - All amounts in **toman** (ZarinPal v4 uses Rial in some endpoints — verify against docs and convert if needed; lock toman as the API contract internally regardless)
  - Refund stub: ZarinPal does not have an automated refund API for all merchants in v1; method throws `REFUND_NOT_SUPPORTED_BY_PROVIDER`. Manual refund process documented for ops.
- `apps/api/src/core/payments/providers/console.provider.ts` — simulates payment for dev/test:
  - `initiate` → returns `redirectUrl: 'http://localhost:3000/_dev/payment-simulator?ref={referenceId}'` — dev frontend page that simulates user paying
  - `verify` → reads from Redis a flag set by the simulator page to fake success/failure
- `apps/api/src/core/payments/payments.module.ts` — picks provider via `PAYMENT_PROVIDER` env (`zarinpal` or `console`, default `console` in dev)

**Acceptance:**

- ZarinPal provider compiles with mock fetch
- Console provider simulates payment locally
- Switching providers via env doesn't change caller code

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, and SAZIQO_PLATFORM_PHASES_8_10.md
fully. Execute Phase 10A.

Build apps/api/src/core/payments/:
- payment-provider.interface.ts: types per the plan
- providers/zarinpal.provider.ts:
  - initiate: POST https://api.zarinpal.com/pg/v4/payment/request.json
    with body { merchant_id, amount, description, callback_url,
    metadata: { mobile, email, order_id: referenceId } }
    Parse response { data: { code, message, authority }, errors: ... }
    On success: redirectUrl =
      `https://www.zarinpal.com/pg/StartPay/${authority}`
    On error: throw PAYMENT_INITIATION_FAILED with details

  - verify: POST https://api.zarinpal.com/pg/v4/payment/verify.json
    with body { merchant_id, amount, authority: providerReference }
    Parse response { data: { code, message, ref_id, card_pan }, errors }
    On code 100 (success) or 101 (already verified — idempotent ok):
      verified=true, referenceCode=ref_id, cardPan=card_pan
    Else: verified=false, failureReason=message

  - refund: throw REFUND_NOT_SUPPORTED_BY_PROVIDER (real refund API
    requires special merchant agreement — manual process for v1)

  CLAUDE: ZarinPal v4 uses toman for amount in newer docs; verify with
  current docs at request time. If they switch back to Rial, convert.
  In code, our contract is toman; provider does conversion internally
  if needed.

  Retry policy: retry once on HTTP 5xx with 500ms delay; do NOT retry
  on 4xx (bad merchant_id etc.).

- providers/console.provider.ts:
  - initiate: returns redirectUrl that points to a dev simulator page
  - verify: reads Redis "dev:payment:{referenceId}" set by simulator,
    {success: bool, referenceCode?: string}
  - refund: console-logs and returns refunded=true

- payments.module.ts: provides PaymentProvider token, picks based on
  PAYMENT_PROVIDER env (default 'console')

Add config to .env.example:
- PAYMENT_PROVIDER=console (note: switch to "zarinpal" when credentials provided)
- ZARINPAL_MERCHANT_ID (placeholder UUID)
- ZARINPAL_CALLBACK_URL (e.g., https://app.saziqo.ir/api/v1/payments/callback)

Add error codes: PAYMENT_INITIATION_FAILED, PAYMENT_VERIFICATION_FAILED,
REFUND_NOT_SUPPORTED_BY_PROVIDER.

Unit tests:
- ZarinPal provider mocks fetch, verifies request shape, response parsing,
  retry on 5xx
- Console provider verifies Redis-based simulation

Commit as "feat(phase-10A): add payment provider interface and zarinpal/
console adapters".
```

---

## Phase 10B: Payment Initiation Endpoint

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Initiation endpoint links to user money. Wrong amount or missing idempotency = duplicate charges.

**Deliverables:**

- New table via migration:
  ```prisma
  model Payment {
    id                BigInt   @id @default(autoincrement())
    userId            BigInt
    amount            BigInt   // toman
    purpose           String   @db.VarChar(50)  // module-defined: 'subscription', 'wallet_topup', 'order:{moduleOrderId}'
    description       String   @db.VarChar(500)
    status            PaymentStatus @default(PENDING)
    providerName      String   @db.VarChar(40)
    providerReference String?  @db.VarChar(120) // ZarinPal authority
    referenceCode     String?  @db.VarChar(120) // bank reference after verify
    cardPanMasked     String?  @db.VarChar(20)
    metadata          Json     // module-specific data
    initiatedAt       DateTime @default(now())
    completedAt       DateTime?
    failureReason     String?  @db.VarChar(500)
    @@index([userId])
    @@index([status])
    @@index([providerReference])
  }
  enum PaymentStatus { PENDING SUCCEEDED FAILED CANCELLED EXPIRED }
  ```
- `apps/api/src/core/payments/payments.service.ts`:
  - `initiate({ userId, amount, purpose, description, metadata? })`:
    1. Insert Payment row with status PENDING
    2. Call provider.initiate({ amount, description, callbackUrl: `${BASE_URL}/api/v1/payments/${payment.id}/callback`, referenceId: payment.id, userMobile, userEmail })
    3. Update Payment with `providerReference`
    4. Return `{ paymentId, redirectUrl }`
  - `findById(id, userId)` — ownership check
- `POST /api/v1/payments/initiate`:
  - JWT required, `@Idempotent()` (mandatory — duplicate request must not double-initiate)
  - Body: `{ amount, purpose, description, metadata? }` — Zod-validated
  - Returns `{ paymentId, redirectUrl }` — frontend redirects user to gateway
- Auto-expiration job: defer to v1.5 (would need BullMQ which is cut). For MVP, expired-but-not-marked payments are detected by reconciliation job in 9E or by a daily ops review.

**Acceptance:**

- Authenticated user initiates payment for 50,000 toman → Payment row created, redirect URL returned
- Same `Idempotency-Key` within 24h → returns same paymentId and redirectUrl (idempotent)
- Negative or zero amount → 400
- Provider failure → Payment marked FAILED, error surfaced to user

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, and SAZIQO_PLATFORM_PHASES_8_10.md
fully. Execute Phase 10B.

Add Prisma migration for Payment table per plan.

Build apps/api/src/core/payments/payments.service.ts:
- initiate({ userId, amount, purpose, description, metadata }):
  1. Validate amount > 0 (Zod earlier should catch)
  2. Validate purpose against allowlist (initial: 'wallet_topup',
     'subscription', 'order:*'); modules later add their own purposes
     via a registration mechanism (Phase 11). For MVP, allow any string
     matching /^[a-z_]+(:.+)?$/.
  3. Look up user for mobile/email pre-fill
  4. Insert Payment row with status PENDING
  5. Call provider.initiate
  6. On provider error: update Payment status=FAILED, failureReason,
     completedAt; throw mapped error
  7. On success: update Payment.providerReference; return
     { paymentId: payment.id, redirectUrl }

- findById(id, userId): ownership check; admin permission bypass for
  admin views

Add PaymentsController:
- @Post('payments/initiate') @Idempotent() @Audit({ action:
  'PAYMENT_INITIATED', resource: 'payment' })
  Zod body: { amount: bigint positive, purpose: string regex,
  description: string max 500, metadata: object optional }
- @Get('users/me/payments') paginated list of own payments
- @Get('users/me/payments/:id') own payment detail
- @Get('admin/payments') @RequirePermission('admin:read:payouts')
  paginated, filters by status/userId/dateRange (reuse existing
  permission since payments and payouts overlap operationally; add
  'admin:read:payments' if you want stricter separation — for MVP, keep
  combined)

Sanitize: never expose providerReference to non-admin users (it's an
internal handle). Show only id, amount, status, completedAt, referenceCode
(safe to show — bank receipt code).

Integration tests:
- Initiate with console provider → redirects to local simulator
- Idempotency: two requests same key → same paymentId
- Negative amount → 400
- Provider failure → Payment marked FAILED

Commit as "feat(phase-10B): add payment initiation endpoint".
```

---

## Phase 10C: Payment Verify Callback + Signature Check

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Callback is where money is confirmed. Forgeable callbacks = unauthorized credits. This is THE highest-stakes endpoint in the system.

**Deliverables:**

- `GET /api/v1/payments/:paymentId/callback` — public endpoint (no JWT — gateway redirects user here)
  - Query params from gateway: `Authority`, `Status` (ZarinPal sends these)
  - Look up Payment by ID, verify `providerReference === Authority`
  - Call `provider.verify({ providerReference: Authority, expectedAmount: payment.amount })`
  - On success:
    - Update Payment to SUCCEEDED with `completedAt`, `referenceCode`, `cardPanMasked`
    - **Trigger payment-to-ledger reconciliation** (Phase 10D) — credit user's wallet, fire `PAYMENT_SUCCEEDED` notification
  - On failure: Payment → FAILED with `failureReason`, fire `PAYMENT_FAILED` notification
  - **Idempotent**: re-hitting the callback for an already-completed Payment must NOT re-credit; returns the existing terminal state
  - Redirects user to a frontend page (not implemented in this phase — placeholder URL `/payment-result/{paymentId}`)
- Signature/integrity verification: ZarinPal v4 does not provide HMAC signatures on the redirect callback; the verification call to ZarinPal is itself the integrity check. We additionally:
  - Verify `Authority` matches our stored `providerReference` (rejects a forged callback for a different payment)
  - Verify amount with the gateway during `verify()` call
  - Use `@Idempotent()` to prevent replay of the same callback URL with stale data
- ZarinPal Status param: `OK` or `NOK` — `NOK` means user cancelled; we mark CANCELLED, not FAILED, distinguishing user-action from gateway error

**Acceptance:**

- Successful callback → Payment SUCCEEDED, wallet credited, user notified
- Re-hitting same callback → no double credit, returns same result
- Forged callback (`Authority` doesn't match) → 400 `INVALID_CALLBACK`
- User cancelled (`Status=NOK`) → Payment CANCELLED, no wallet change, user notified with cancellation message (add `PAYMENT_CANCELLED` template)
- Verify failure (gateway says payment failed) → Payment FAILED

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, and SAZIQO_PLATFORM_PHASES_8_10.md
fully. Execute Phase 10C.

Add to NotificationsService catalog: PAYMENT_CANCELLED type with Persian
template "پرداخت توسط شما لغو شد".

Add to PaymentsService:
- handleCallback({ paymentId, providerReference, providerStatus }):
  1. Lookup Payment by id; if not found → throw NOT_FOUND
  2. If payment.status is already terminal (SUCCEEDED/FAILED/CANCELLED)
     → return current state idempotently (don't reprocess)
  3. Verify providerReference matches payment.providerReference; if not
     → throw INVALID_CALLBACK
  4. If providerStatus === 'NOK' (user cancelled): mark CANCELLED, set
     completedAt, dispatch PAYMENT_CANCELLED, return
  5. Else (status OK): call provider.verify({ providerReference,
     expectedAmount: payment.amount })
  6. On verify.verified true:
     - $transaction:
       - Mark Payment SUCCEEDED, set completedAt, referenceCode,
         cardPanMasked
       - Call paymentToLedgerReconciler (introduced in 10D — for now
         stub that takes paymentId and is implemented next phase)
     - Dispatch PAYMENT_SUCCEEDED IN_APP + SMS
  7. On verify.verified false: mark FAILED with failureReason; dispatch
     PAYMENT_FAILED

Add PaymentsController:
- @Get('payments/:paymentId/callback') @Public()
  Query: Authority (string), Status ('OK' | 'NOK')
  Calls handleCallback, returns redirect to frontend page
  /payment-result/{paymentId}
  @Audit({ action: 'PAYMENT_CALLBACK_RECEIVED', resource: 'payment',
    resourceIdParam: 'paymentId' })

Add error code: INVALID_CALLBACK.

Idempotency: the callback URL is GET, but state changes are protected
by the early-return on terminal states (step 2 above). This is correct
for GET callbacks where idempotency-key headers are not available.

Integration tests:
- Successful flow: initiate → simulator marks success → callback →
  Payment SUCCEEDED, wallet credited (test deferred until 10D wires
  the ledger), user notified
- Re-hit callback → no double credit
- Forged Authority → 400 INVALID_CALLBACK
- Status=NOK → CANCELLED
- Verify failure → FAILED

Commit as "feat(phase-10C): add payment verify callback".
```

---

## Phase 10D: Payment-to-Ledger Reconciliation

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** This is the bridge between external payment provider and internal money ledger. Drift here means external balance doesn't match internal records.

**Deliverables:**

- `apps/api/src/core/payments/payment-ledger.reconciler.ts`:
  - `reconcile(paymentId)` called from `PaymentsService.handleCallback` on SUCCESS:
    1. Look up Payment
    2. Determine ledger action based on `purpose`:
       - `wallet_topup` → credit user's wallet by `payment.amount`
       - `subscription` → no wallet change; module that initiated the payment will read the SUCCEEDED status and grant the subscription (this is the "module-aware" hook — system credits wallet only if explicitly told to)
       - `order:{moduleOrderId}` → no wallet change; the originating module handles fulfillment by reading the SUCCEEDED status
    3. Insert ledger entries with `reference = "payment:{paymentId}"` for traceability
    4. Update wallet balance via `LedgerService` (atomic)
    5. All inside the same `$transaction` as the payment status update from 10C
  - Idempotency: check if a ledger entry with `reference = "payment:{paymentId}"` already exists for the user; if yes, skip (already reconciled)
- For MVP, only `wallet_topup` purpose triggers automatic ledger credit. Other purposes are passive — modules read payment status themselves.
- Add new endpoint `GET /api/v1/payments/:paymentId/status` — JWT, ownership-checked — modules and frontend can poll to know when payment completes

**Acceptance:**

- Wallet topup payment → wallet credited exactly once
- Re-running reconciliation on already-reconciled payment → no-op
- Subscription/order payments → no wallet change (module's job)
- Status endpoint returns current state for polling

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, and SAZIQO_PLATFORM_PHASES_8_10.md
fully. Execute Phase 10D.

Build apps/api/src/core/payments/payment-ledger.reconciler.ts:
- reconcile(paymentId): called inside the $transaction in
  PaymentsService.handleCallback after payment status set to SUCCEEDED.
  1. Look up Payment
  2. Check idempotency: SELECT 1 FROM ledger_entry WHERE reference =
     `payment:${paymentId}` LIMIT 1; if exists, return early
  3. Switch on payment.purpose:
     - 'wallet_topup': call walletsService.findOrCreateForUser(userId),
       then ledgerService.credit({ walletId, amount: payment.amount,
       reference: `payment:${paymentId}`, description: `Wallet topup —
       payment #${paymentId}`, metadata: { paymentId } })
     - 'subscription' or matches /^order:/: do nothing — module is
       responsible for fulfillment when it reads payment.status=SUCCEEDED
     - Unknown purpose: log warning, do nothing
  4. Return

Update PaymentsService.handleCallback to call paymentLedgerReconciler.
reconcile(paymentId) inside the $transaction at the success branch
(step 6 from Phase 10C).

Add PaymentsController endpoint:
- @Get('payments/:paymentId/status') @RequirePermission(
  'users:read:profile_self') ownership via service
  Returns sanitized Payment (id, status, amount, referenceCode, completedAt)

Integration tests:
- wallet_topup full flow: initiate → callback success → wallet credited
  with exact amount, ledger entry exists with reference="payment:{id}"
- Re-trigger reconciliation manually (call reconcile twice) → idempotent
- subscription purpose: callback success → no wallet change, status
  endpoint shows SUCCEEDED for module to read
- Polling: status endpoint returns current state
- Ownership: user A cannot read user B's payment status → 403 NOT_FOUND
  (return NOT_FOUND for non-owned to avoid leaking existence)

Commit as "feat(phase-10D): add payment-to-ledger reconciliation".
```

---

## Phase 10E: Refund Endpoint (admin-only via S6 confirm)

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** Refunds are reverse-money. Admin error = real loss.

**Deliverables:**

- `POST /api/v1/admin/payments/:paymentId/refund`
  - `@RequirePermission('admin:approve:payout')` (reuses payout permission since refunds are similar in financial gravity)
  - `@AdminOnly({ confirmHeader: true })`
  - `@Idempotent()`
  - Body: `{ amount?, reason }` — partial refunds allowed; `amount` defaults to full payment amount
- `apps/api/src/core/payments/payments.service.ts`:
  - `refund({ paymentId, amount, reason, actorUserId })`:
    1. Verify Payment status = SUCCEEDED
    2. Verify `amount <= payment.amount - already-refunded`
    3. Call `provider.refund` — currently throws `REFUND_NOT_SUPPORTED_BY_PROVIDER` for ZarinPal in v1
    4. **Manual refund mode** (default when provider doesn't support automated): record a Refund row, debit user's wallet (if topup) or just log the refund obligation, dispatch `PAYMENT_REFUNDED` notification, mark this as "pending manual bank transfer" — operations manually transfers the funds outside the platform
- New table:
  ```prisma
  model Refund {
    id              BigInt   @id @default(autoincrement())
    paymentId       BigInt
    amount          BigInt
    reason          String   @db.VarChar(500)
    status          RefundStatus @default(PENDING_MANUAL)
    requestedByUserId BigInt
    requestedAt     DateTime @default(now())
    completedAt     DateTime?
    bankReference   String?  @db.VarChar(120)
    @@index([paymentId])
    @@index([status])
  }
  enum RefundStatus { PENDING_MANUAL COMPLETED }
  ```
- Endpoint to mark refund completed: `PATCH /api/v1/admin/refunds/:id/mark-completed` — admin sets `bankReference` after manually transferring

**Acceptance:**

- Admin requests refund → Refund row PENDING_MANUAL, wallet debited (for topup-purpose payments only), user notified
- Cannot refund non-SUCCEEDED payment
- Cannot refund more than payment amount minus prior refunds
- Mark-completed sets bank reference and status COMPLETED
- All actions audited, S6 confirm enforced

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md,
SAZIQO_PLATFORM_PHASES_5_7.md, and SAZIQO_PLATFORM_PHASES_8_10.md
fully. Execute Phase 10E.

Add Prisma migration for Refund table per plan.

Add to NotificationsService catalog: PAYMENT_REFUNDED type with Persian
template "بازگشت وجه به مبلغ {amount} تومان درخواست شد و به‌زودی به حساب
شما واریز می‌شود.".

Add to PaymentsService:
- refund({ paymentId, amount, reason, actorUserId }):
  1. Look up Payment, ensure status === SUCCEEDED
  2. Compute alreadyRefunded = SUM(amount) FROM Refund WHERE paymentId
     AND status COMPLETED
  3. Validate amount <= payment.amount - alreadyRefunded; else throw
     REFUND_AMOUNT_EXCEEDS_AVAILABLE
  4. Try provider.refund({ providerReference, amount, reason })
  5. If provider returns REFUND_NOT_SUPPORTED_BY_PROVIDER (ZarinPal v1):
     - Insert Refund row with status PENDING_MANUAL, requestedByUserId
       = actorUserId
     - If payment.purpose === 'wallet_topup': ledgerService.debit user's
       wallet by amount with reference `refund:${refund.id}` (this might
       fail if user spent the money — handle INSUFFICIENT_FUNDS by
       throwing CANNOT_REFUND_INSUFFICIENT_BALANCE; admin must resolve
       manually)
     - Dispatch PAYMENT_REFUNDED IN_APP + SMS
     - Return refund record
  6. Else (provider supports auto): mark Refund COMPLETED immediately,
     same wallet debit, dispatch notification

- markRefundCompleted({ refundId, bankReference, actorUserId }):
  Set status COMPLETED, completedAt, bankReference. For refunds where
  ledger debit didn't happen yet (e.g., admin couldn't debit due to
  insufficient balance), this also performs the debit — but for MVP,
  assume debit happened at request time and this is just an ops-confirmation
  endpoint.

Add error codes: REFUND_AMOUNT_EXCEEDS_AVAILABLE, CANNOT_REFUND_INSUFFICIENT_BALANCE,
REFUND_NOT_SUPPORTED_BY_PROVIDER.

Add PaymentsAdminController:
- @Post('admin/payments/:paymentId/refund') @RequirePermission(
  'admin:approve:payout') @AdminOnly({ confirmHeader: true })
  @Idempotent() @Audit({ action: 'PAYMENT_REFUND_REQUESTED', resource:
  'payment', resourceIdParam: 'paymentId' })
  Body: { amount?: bigint, reason: string min 10 }
- @Patch('admin/refunds/:id/mark-completed') same permission +
  @AdminOnly({ confirmHeader: true }) @Audit
- @Get('admin/refunds') @RequirePermission('admin:read:payouts')
  Paginated, filters by status

Integration tests:
- Refund full flow: payment SUCCEEDED → admin refund → Refund PENDING_MANUAL
  + wallet debited + user notified → admin mark-completed → Refund COMPLETED
- Cannot refund FAILED payment
- Cannot exceed payment amount via cumulative refunds
- Insufficient wallet balance for reversal → CANNOT_REFUND_INSUFFICIENT_BALANCE
  → admin must resolve manually

Commit as "feat(phase-10E): add refund endpoint with manual completion
workflow".
```

---

## Test Gate 10: Payments Verification (with Mock ZarinPal)

**Model: 🔴 Opus**

- [ ] Console provider full flow: initiate → simulator success → callback → Payment SUCCEEDED, wallet credited (if topup)
- [ ] Idempotent initiation: same Idempotency-Key returns same paymentId
- [ ] Replay callback: no double-credit, returns existing terminal state
- [ ] Forged callback (wrong Authority) → 400
- [ ] User cancellation (Status=NOK) → CANCELLED, no wallet change, notification
- [ ] Verify failure → FAILED, notification
- [ ] Subscription/order purpose: callback succeeds, no wallet change
- [ ] Status endpoint returns current state (for module polling)
- [ ] Refund flow: admin refund SUCCEEDED payment → Refund PENDING_MANUAL, wallet debited
- [ ] Cannot exceed payment amount via cumulative refunds
- [ ] All payment + refund actions in audit log
- [ ] All payment + refund actions trigger notifications
- [ ] S6 confirm enforced on refund endpoints
- [ ] Reconciliation report still consistent after payments and refunds

---

# What Comes After Phase Group 10

You now have:

- Notifications (in-app + SMS, email-ready, hardcoded Persian templates)
- Internal ledger with append-only enforcement, atomic transfers, reconciliation
- Wallets with auto-creation on profile completion
- Payout queue with manual approval workflow
- ZarinPal payment integration (abstracted; console adapter for dev) with full lifecycle: initiate → callback → ledger reconciliation
- Manual refund workflow (provider auto-refund deferred)

**Combined with Phase Groups 1–7, the system layer is functionally complete.** What remains:

- **Phase Group 11:** Module Registry + Contract — formalizes how modules plug in
- **Phase Group 12–14:** Next.js frontend (auth UI, app shell, admin shell)
- **Phase Group 15:** Production hardening (VPS, Caddyfile, security)
- **Phase Group 16:** Release pipeline + comment stripping + docs

**Recommended next step:** approve Phase Groups 5–10, save to skill, build via Claude Code over 2–3 sessions (~22 hours estimated). Then expand Phase Groups 11–16 in a final pass before production.

---

## Open Decisions That Block Phase Groups 11–16

When you choose to expand Phase Groups 11–16, these need answers:

1. **Module loading mechanism:** static `import` in `modules.config.ts` (compile-time) vs dynamic file-system scan? My recommendation: static, simpler.
2. **First module to plan:** which marketplace ships first? Agents, Builders, or Templates?
3. **Frontend domain:** confirm `app.saziqo.ir`?
4. **shadcn/ui component palette:** which components do we install upfront vs per-module?
5. **Production VPS specs:** 4 vCPU / 4 GB RAM / 80 GB SSD adequate for v1?
6. **Backup destination:** Arvan Object Storage / Pars-Pack S3 / other?
7. **Error tracking:** GlitchTip self-hosted from day one, or just Pino-to-file in v1?

These do not block Phase Groups 5–10 execution.
