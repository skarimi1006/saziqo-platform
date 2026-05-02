# سازیکو Platform — Phase Groups 14–16 (Lean MVP, Executable)

> Read alongside `saziqo-platform-system-plan.md`, `phases-1-4.md`, `phases-5-7.md`, `phases-8-10.md`, `phases-11-13.md`.
> Phase Groups 14–16 complete the system: full app shell, admin operations console, production deployment, release pipeline with comment-stripping, quality gates, and documentation.

---

# Phase Group 14 — Layout + Admin Shell

## Phase 14A: App Shell (sidebar + header + content area)

**Model: 🟢 Sonnet** | ~200 LOC

**Deliverables:**

- `apps/web/src/app/(account)/layout.tsx` — replaces the minimal layout from Phase 13C with a full app shell:
  - Top bar (header) — fixed, glass-blur background, contains logo, user menu, notifications bell, mobile menu trigger
  - Sidebar — fixed left (in RTL means visually right), collapsible on mobile via shadcn `Sheet`
  - Main content area — `<main>` with padding, holds `children`
- `apps/web/src/components/layout/app-shell.tsx` — composition of header + sidebar + main
- `apps/web/src/components/layout/sidebar.tsx` — nav links rendered from a config:
  ```typescript
  const NAV_ITEMS = [
    { href: '/dashboard', labelFa: 'داشبورد', icon: LayoutDashboard },
    { href: '/wallet', labelFa: 'کیف پول', icon: Wallet },
    { href: '/settings/profile', labelFa: 'پروفایل', icon: User },
    { href: '/settings/sessions', labelFa: 'نشست‌ها', icon: Monitor },
    // Module nav items injected at runtime from module-registry's
    // mergeAdminPages() result (admin routes only) and from a parallel
    // mergeUserPages() (added to module contract)
  ];
  ```
- Active link highlighting via `usePathname()`
- Mobile breakpoint (< 768px): sidebar collapses, header shows hamburger
- Loading skeleton shown when `useAuth().isLoading === true`
- Unauthenticated state: redirect to `/login` (handled at layout level)

**Acceptance:**

- Logged-in user sees full shell at `/dashboard`
- Sidebar nav highlights active route
- Mobile viewport: sidebar hidden, hamburger opens drawer
- Unauthenticated → redirect to `/login`
- Loading state → skeleton, no flash of content

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 14A.

Install shadcn components: sheet, separator, tooltip.
Install: lucide-react (icon library).

Build apps/web/src/components/layout/app-shell.tsx:
- 'use client'
- Renders header at top, sidebar at right (RTL = visual right, dir='rtl'
  flips left/right semantics so we use start/end), main content fills rest
- Layout: header (h-14 fixed top), sidebar (w-64 fixed start, top-14
  bottom-0, hidden on mobile), main (mr-64 on desktop, mr-0 on mobile,
  pt-14)
  Note: mr-64 because RTL — equivalent to ml-64 in LTR semantics

Build apps/web/src/components/layout/sidebar.tsx:
- Reads NAV_ITEMS config from apps/web/src/config/nav.ts
- Renders <nav> with <Link>s; usePathname for active state
- Active: bg-orange/10 text-orange-deep
- Hover: bg-bg-soft
- Icons from lucide-react (LayoutDashboard, Wallet, User, Monitor)

Build apps/web/src/components/layout/mobile-menu.tsx:
- shadcn Sheet triggered by hamburger in header
- Same nav items, full-width sliding from start side

Build apps/web/src/components/layout/header.tsx (placeholder for now,
expanded in 14B):
- Logo on start side (right in RTL)
- Hamburger on start (visible only on mobile)
- User menu placeholder on end side (left in RTL)

Update apps/web/src/app/(account)/layout.tsx:
- 'use client'
- useAuth: if isLoading, render skeleton; if !isAuthenticated,
  router.push('/login') and render null
- Else: render <AppShell>{children}</AppShell>

Build apps/web/src/app/(account)/dashboard/page.tsx as a placeholder
landing page that just shows "خوش آمدید, {user.firstName}" so the
shell has something to display.

Verify in dev:
- /dashboard shows shell with sidebar
- Mobile (devtools 375px) shows hamburger
- Active link highlights
- Loading skeleton shown briefly on reload

Commit as "feat(phase-14A): add app shell with sidebar and header".
```

---

## Phase 14B: Logo Component + Brand Orange Accents + User Menu

**Model: 🟢 Sonnet** | ~180 LOC

**Deliverables:**

- `apps/web/src/components/brand/logo.tsx`:
  - SVG-based logo (inline, no image file required)
  - Variants: `dark` (header, light bg) and `light` (footer/dark areas)
  - Sizes: `sm` (24px height), `md` (32px), `lg` (48px)
  - Wordmark "سازیکو" in Vazirmatn ExtraBold + orange dot mark to the start side
- Header now renders the Logo at the start side
- `apps/web/src/components/user-menu/user-menu.tsx`:
  - Triggered by avatar (initials fallback if no avatar) at end side of header
  - Uses shadcn `DropdownMenu`
  - Menu items: "پروفایل" → `/settings/profile`, "نشست‌ها" → `/settings/sessions`, "کیف پول" → `/wallet`, separator, "خروج" (red text)
  - Avatar: shows first letter of `user.firstName` if no image; size 32px
  - If `isImpersonating`: orange banner above the menu showing "در حال شبیه‌سازی به جای {target}" with a "پایان شبیه‌سازی" link
- Logout button calls `logout()` from Phase 13D

**Acceptance:**

- Logo visible in header
- User menu opens on click
- Menu items navigate correctly
- Logout works
- Impersonation banner appears when active

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 14B.

Install shadcn: dropdown-menu, avatar.

Build apps/web/src/components/brand/logo.tsx:
- Inline SVG: orange circle dot (#f97316) + "سازیکو" wordmark
- Props: variant ('dark' | 'light'), size ('sm' | 'md' | 'lg')
- 'dark' variant: ink (#0f172a) wordmark + orange dot
- 'light' variant: white wordmark + orange dot

Update apps/web/src/components/layout/header.tsx:
- Start side: Logo size="md" variant="dark"
- End side: UserMenu component

Build apps/web/src/components/user-menu/user-menu.tsx:
- 'use client'
- shadcn DropdownMenu triggered by Avatar (shadcn) showing initials
- Menu structure per the plan
- "خروج" item calls logout() from lib/logout.ts (await it; the function
  redirects)
- If authStore.isImpersonating: render a divider + small section showing
  "در حال شبیه‌سازی به جای کاربر #{authStore.impersonationTargetId}" +
  link "پایان شبیه‌سازی" → POST /admin/impersonation/stop, then
  authStore.refreshUser(), then router.push('/dashboard')

Avatar fallback: extract first character of user.firstName via
String.fromCodePoint(user.firstName.codePointAt(0)) for proper Persian
rendering (Persian doesn't have "first letter" in the Latin sense; just
take the first grapheme).

Verify in dev:
- Logo renders in header
- User menu opens, items navigate
- Logout works end-to-end

Commit as "feat(phase-14B): add logo and user menu".
```

---

## Phase 14C: Notifications Bell + Dropdown (poll-based, no WS in MVP)

**Model: 🟢 Sonnet** | ~180 LOC

**Why no WS:** WebSocket gateway was cut in lean MVP. Polling every 30 seconds is sufficient for in-app notification badge and is operationally simpler.

**Deliverables:**

- `apps/web/src/components/notifications/notifications-bell.tsx`:
  - Bell icon in header (start side, before user menu in RTL)
  - Badge with unread count (red circle with number) — only shown when count > 0
  - Polling: every 30 seconds, calls `GET /api/v1/users/me/notifications/count-unread`
  - Uses react-query `useQuery` with `refetchInterval: 30000`
- Click opens shadcn `DropdownMenu`:
  - Lists most recent 10 unread notifications via `GET /api/v1/users/me/notifications?unreadOnly=true&limit=10`
  - Each row: `renderedTitle`, `renderedBody` (truncated), `createdAt` Jalali relative
  - Click on row: marks as read via `PATCH /:id/read`, optionally navigates if notification has a deep link in payload
  - "علامت‌گذاری همه به‌عنوان خوانده‌شده" button at bottom → calls `read-all`
  - "مشاهده همه" link at bottom → navigates to `/notifications`
- `apps/web/src/app/(account)/notifications/page.tsx` — full list with infinite scroll (deferred to v1.5 — for MVP, just paginated 50 per page)

**Acceptance:**

- Bell shows correct unread count, updates every 30s
- Dropdown lists latest 10
- Clicking a row marks as read; badge count decreases
- "Mark all read" empties badge
- Full list page renders 50 entries with cursor pagination

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 14C.

Build apps/web/src/components/notifications/notifications-bell.tsx:
- 'use client'
- Bell icon (lucide Bell)
- useQuery: ['notifications', 'count-unread'], queryFn fetches /users/me/
  notifications/count-unread, refetchInterval: 30000
- Badge displayed when data.count > 0; shadcn Badge variant="destructive"
- DropdownMenu opens on click
- Inside dropdown:
  - useQuery: ['notifications', 'latest-unread'], fetches /users/me/
    notifications?unreadOnly=true&limit=10, enabled only when dropdown
    is open (lazy)
  - Each row: title (font-medium), body (text-sm, line-clamp-2), date
    (text-xs ink-dim) using formatJalaliRelative
  - Click row: PATCH /:id/read (useMutation), then invalidate both
    queries; if payload.deepLink present, router.push(deepLink)
  - "Mark all read" button: PATCH /read-all, invalidate
  - "View all" link: router.push('/notifications')

Build apps/web/src/app/(account)/notifications/page.tsx:
- Paginated list of all notifications
- Use react-query's useInfiniteQuery for cursor-based pagination
  (50 per page); render shadcn Card per row
- Mark-read on click (no navigation unless deep link)

Update apps/web/src/components/layout/header.tsx: insert NotificationsBell
between mobile menu and UserMenu on the end side.

Set up react-query provider in apps/web/src/app/layout.tsx:
- Wrap children in <QueryClientProvider client={queryClient}>
- queryClient defaults: staleTime 30s, retry 1

Verify in dev:
- Send a notification via API (admin tool or Prisma Studio)
- Within 30s, badge appears with count
- Click bell, see notification, click row → marked as read

Commit as "feat(phase-14C): add notifications bell with polling".
```

---

## Phase 14D: Admin Shell Layout + Role-Gated Nav

**Model: 🟢 Sonnet** | ~180 LOC

**Deliverables:**

- `apps/web/src/app/(admin)/layout.tsx`:
  - Permission gate: requires `admin:read:users` OR `super:everything` (any one of "admin-grade" permissions); else shows 403 page
  - Reuses `AppShell` but with admin-specific sidebar
- `apps/web/src/components/layout/admin-sidebar.tsx`:
  - Static admin nav items + dynamic items from module registry's `mergeAdminPages` result
  - Static items:
    - "کاربران" → `/admin/users` (perm: `admin:read:users`)
    - "گزارش حسابرسی" → `/admin/audit` (perm: `admin:read:audit_log`)
    - "صف تسویه" → `/admin/payouts` (perm: `admin:read:payouts`)
    - "پرداخت‌ها" → `/admin/payments` (perm: `admin:read:payouts`)
    - "بازگشت وجه" → `/admin/refunds` (perm: `admin:read:payouts`)
  - Dynamic items: fetched from `GET /api/v1/admin/registry/admin-pages` (new endpoint that returns the merged admin pages from registry)
  - Per-item permission check via a `usePermission(code)` hook that reads from authStore.user.permissions (populated on login)
- `apps/web/src/hooks/use-permission.ts`:
  - `usePermission(code: string): boolean`
  - Checks user.permissions includes `code` OR includes `super:everything` OR matches wildcard pattern (e.g., user has `agents:*:*`, asking `agents:read:listing` → true)
- Update `/users/me` response to include `permissions: string[]` (already in user object via UsersService.findByIdForAdmin pattern, replicate for self read)

**Acceptance:**

- Regular user → `/admin/dashboard` → 403 page
- Admin user → admin shell renders with role-gated nav
- Module-registered admin pages appear in sidebar
- Nav items hidden if user lacks permission

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 14D.

Add to API:
- GET /api/v1/admin/registry/admin-pages @RequirePermission(
  'admin:read:users') — returns ModuleRegistryService.mergeAdminPages()
  result, sanitized
- Update GET /api/v1/users/me to include permissions: string[] derived
  from user's roles via permissionsService.getUserPermissions(user.id)

Build apps/web/src/hooks/use-permission.ts:
- usePermission(code: string): boolean
- Reads authStore.user.permissions
- Match logic:
  - Exact match
  - 'super:everything' wildcard
  - Module wildcard: user has 'agents:*:*' matches 'agents:read:listing'
    (split by ':' and compare segments allowing '*')

Build apps/web/src/app/(admin)/layout.tsx:
- 'use client'
- useAuth + usePermission('admin:read:users')
- If not authenticated → /login
- If isLoading → skeleton
- If no admin perm → render <Forbidden /> component
- Else → <AppShell sidebar={<AdminSidebar />}>{children}</AppShell>
  (modify AppShell to accept sidebar prop)

Build apps/web/src/components/layout/admin-sidebar.tsx:
- Static nav items per the plan, each gated by usePermission
- Dynamic items: useQuery for /admin/registry/admin-pages, render after
  static items, sorted by order
- Each item: Link with icon (lucide), title, active state

Build apps/web/src/components/forbidden.tsx:
- Centered: orange shield icon, title "دسترسی غیرمجاز", description
  "شما اجازه دسترسی به این بخش را ندارید."
- "بازگشت به داشبورد" button

Build apps/web/src/app/(admin)/dashboard/page.tsx as a placeholder admin
landing showing some basic stats (count of users, count of payments
today, etc.) — call /admin/users?limit=1 just for total counts via
meta if exposed; otherwise placeholder cards.

Verify in dev:
- Regular user → /admin/dashboard → Forbidden component
- Super admin (seeded user) → admin sidebar visible

Commit as "feat(phase-14D): add admin shell with role-gated nav".
```

---

## Phase 14E: Admin — Users List + Audit Log + Payout Queue UI

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Admin operations UI must be safe (no accidental destructive actions). Plus three pages in one phase requires careful structure.

**Deliverables:**

- `apps/web/src/app/(admin)/users/page.tsx`:
  - Filterable table of users via `GET /admin/users`
  - Filters at top: status select, search input, role select
  - Columns: id, phone, name, email, status (badge), createdAt (Jalali), actions
  - Action column: "مشاهده" → `/admin/users/:id` detail page
  - Cursor pagination footer
- `apps/web/src/app/(admin)/users/[id]/page.tsx`:
  - User detail showing all fields
  - "تغییر وضعیت" → opens dialog with status select; submits PATCH
  - "افزودن نقش" → opens dialog with role select; submits POST roles
  - "حذف نقش" buttons next to each assigned role
  - "شبیه‌سازی" button (`@RequirePermission('admin:impersonate:user')`) → opens dialog requiring reason (min 10 chars) → POST /admin/impersonation/start with `X-Admin-Confirm: true` header → on success, replace authStore tokens with impersonation tokens, navigate to `/dashboard`
- `apps/web/src/app/(admin)/audit/page.tsx`:
  - Filterable table via `GET /admin/audit`
  - Filters: action select (multi-select with comma join), actorUserId search, resource, dateFrom, dateTo, failed checkbox
  - Each row: time (Jalali full), actor (name + phone masked), action, resource, status (success/failure)
  - Click row → side panel with full payload (formatted JSON)
- `apps/web/src/app/(admin)/payouts/page.tsx`:
  - Tabs: "در انتظار", "تأیید شده", "پرداخت شده", "رد شده", "لغو شده"
  - Each tab lists payouts of that status
  - Row actions for PENDING: "تأیید", "رد" (with reason)
  - Row actions for APPROVED: "ثبت پرداخت" (with bank reference)
  - All destructive/state-changing actions go through AlertDialog confirm + send `X-Admin-Confirm: true` header

**Acceptance:**

- Admin lists, filters, paginates users
- User detail shows status, roles, sessions count
- Status change works via dialog
- Role assign/remove works
- Impersonation dialog requires reason, succeeds, switches to target user view
- Audit log filters and pagination work
- Payout tabs display correct counts; approve/reject/mark-paid actions work

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 14E.

Install shadcn: table, select, alert-dialog, dialog, tabs, badge,
textarea, calendar, popover.

Build apps/web/src/app/(admin)/users/page.tsx:
- 'use client'
- Filter state: { status?, roleId?, search?, cursor? }
- useQuery for /admin/users with current filters
- Render shadcn Table with columns per plan
- Pagination footer with "بعدی" button using nextCursor from response

Build apps/web/src/app/(admin)/users/[id]/page.tsx:
- useQuery for /admin/users/:id
- Card layout showing all fields
- "تغییر وضعیت" button opens shadcn Dialog with status Select; on submit:
  PATCH /admin/users/:id with { status }, invalidate query
- "افزودن نقش" Dialog: list available roles via /admin/roles (build that
  endpoint quickly: GET /admin/roles returns Role list with permission
  admin:read:users); on submit POST /admin/users/:id/roles
- "حذف نقش" buttons: AlertDialog confirm → DELETE /admin/users/:id/roles/:roleId
- "شبیه‌سازی" Dialog (only if usePermission('admin:impersonate:user')):
  - Textarea for reason (min 10 chars)
  - Submit: POST /admin/impersonation/start with X-Admin-Confirm: true
    header (apiClient.post supports headers option)
  - On success: replace authStore tokens with response.data.tokens,
    refreshUser to load target user, router.push('/dashboard')
  - Show toast "وارد حساب کاربر شدید — برای خروج از منوی کاربر استفاده کنید"

Build apps/web/src/app/(admin)/audit/page.tsx:
- Filters at top with shadcn Select, Input, DatePicker (calendar +
  popover combo)
- Table; click row opens shadcn Sheet from end side showing full payload
  rendered as syntax-highlighted JSON (use a small custom JSON renderer
  with monospace font and color-coded keys/strings)

Build apps/web/src/app/(admin)/payouts/page.tsx:
- Tabs for status; each tab fetches /admin/payouts?status=...
- Table with row actions per status
- Approve: AlertDialog → PATCH /admin/payouts/:id/approve with
  X-Admin-Confirm: true
- Reject: Dialog with reason textarea → PATCH /admin/payouts/:id/reject
  with reason and X-Admin-Confirm: true
- Mark paid: Dialog with paymentReference input → PATCH /admin/payouts/
  :id/mark-paid with X-Admin-Confirm: true

Helper apps/web/src/lib/admin-mutate.ts:
- async adminMutate(method, path, body): wraps apiClient with
  X-Admin-Confirm: true header automatically

Verify in dev (with seeded super_admin):
- Users list, filter, paginate
- Status change works
- Impersonation full flow (start from admin, end from user menu)
- Audit log filters
- Payout flows: approve, reject, mark-paid

Commit as "feat(phase-14E): add admin users, audit, and payouts pages".
```

---

## Phase 14F: Impersonation Banner + Start UI Polish (S3 Frontend)

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** Impersonation UI is the visual safeguard that prevents admins from forgetting they're acting as another user.

**Deliverables:**

- `apps/web/src/components/impersonation/impersonation-banner.tsx`:
  - Renders globally when `authStore.isImpersonating === true`
  - Sticky orange bar at very top of viewport (above header)
  - Text: "در حال شبیه‌سازی به جای: {targetUser.firstName} {targetUser.lastName} ({targetUser.phone-masked}) — توسط {actorName}"
  - "پایان شبیه‌سازی" button on the end side → calls `POST /admin/impersonation/stop`, then refreshes user (reverts to admin's own session)
  - Banner shifts the rest of the layout down by its height (use a CSS variable `--impersonation-banner-height` set to `0px` by default, `40px` when impersonating, applied as `padding-top` on body)
- Update `authStore`:
  - On `setAuth`, decode JWT to detect `imp` claim
  - If present: set `isImpersonating: true`, fetch actor details via `GET /admin/users/:actorUserId/light` (lightweight endpoint returning just name + phone)
  - When stopping impersonation: clear impersonation fields and refresh user via the cookie (which still belongs to the original admin)
- Behavior nuances:
  - During impersonation, admin's previous refresh cookie is preserved (server-side: impersonation does NOT revoke the admin's original session — it just mints a new short-lived target token)
  - "Stop" calls `/admin/impersonation/stop` then re-bootstraps from refresh cookie → admin is back

**Server-side change required (small):**

- Update `SessionsService.issueImpersonationTokens` (Phase 5C): the impersonation tokens are short-lived (15 min access, no refresh — caller must end impersonation explicitly within that window or it auto-expires)
- After `stop`, frontend calls `bootstrap()` which uses the original admin's refresh cookie to restore admin session

**Acceptance:**

- Impersonation start → orange banner appears, layout pushes down
- All UI shows target user's data (notifications, wallet, etc.)
- Banner shows "via {admin name}"
- "Stop" returns to admin view, banner disappears
- Impersonation auto-expires after 15 min → next API call returns 401, frontend redirects to login (admin can re-bootstrap from cookie immediately)

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 14F.

Server-side updates:
- Add GET /api/v1/admin/users/:id/light @RequirePermission('admin:read:users')
  returns { id, firstName, lastName, phoneMasked }
- Verify SessionsService.issueImpersonationTokens issues access JWT
  with 15-min expiry but NO refresh token (impersonation is not
  long-lived; admin must keep using or end it). The refresh cookie
  remains the admin's original.

Frontend:

Build apps/web/src/components/impersonation/impersonation-banner.tsx:
- 'use client'
- useAuth — show only when isImpersonating
- Sticky bar at top, h-10, bg-orange, text-white
- Layout: target name + phone masked on start side, actor name in middle,
  "پایان شبیه‌سازی" button on end side
- Stop handler: apiClient.post('/admin/impersonation/stop'), then
  authStore.bootstrap() (uses cookie to restore admin), then
  router.push('/admin/users') (back to where impersonation likely started)

Update apps/web/src/app/layout.tsx:
- Render <ImpersonationBanner /> at the very top of body, above
  <AuthBootstrap>
- Add CSS variable handling: when isImpersonating, apply class
  'impersonating' to body which sets padding-top: 40px

Update apps/web/src/store/auth.store.ts:
- After setAuth, decode JWT 'imp' claim
- If present:
  - Set isImpersonating = true, impersonationActorId
  - Fetch actor details: apiClient.get(`/admin/users/${actorId}/light`)
  - Store impersonationActor
- After /admin/impersonation/stop response, do bootstrap() which clears
  isImpersonating because the new tokens won't have the imp claim

Verify in dev:
- Start impersonation → orange banner appears
- Browse the app → see target's data
- Click stop → return to admin view, banner disappears

Commit as "feat(phase-14F): add impersonation banner and stop ui".
```

---

## Test Gate 14: Frontend Layout + Admin Shell Verification

**Model: 🟢 Sonnet**

- [ ] App shell renders for authenticated users
- [ ] Sidebar navigation works in RTL
- [ ] Mobile menu opens via hamburger
- [ ] Logo and user menu visible in header
- [ ] User menu items navigate correctly
- [ ] Logout works
- [ ] Notifications bell polls and updates badge
- [ ] Notifications dropdown lists, mark-read works
- [ ] Admin shell only renders for users with admin permissions
- [ ] Admin sidebar shows static + module-registered items
- [ ] Users admin: list, filter, detail, mutate (status, roles), impersonate
- [ ] Audit log: filter, pagination, payload viewer
- [ ] Payouts: tabs, approve/reject/mark-paid with confirm
- [ ] Impersonation banner appears, "stop" returns to admin
- [ ] All admin destructive actions send `X-Admin-Confirm: true`
- [ ] Mobile viewport: all admin pages render without horizontal scroll
- [ ] No console errors

---

# Phase Group 15 — Production Hardening

## Phase 15A: VPS Provisioning Script

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** Server provisioning has security implications. Wrong defaults persist for years.

**Pre-execution requirements (manual):**

- Iranian VPS rented (Arvan / Pars-Pack / Asiatech recommended) — minimum 4 vCPU / 4 GB RAM / 80 GB SSD
- Ubuntu 24.04 LTS installed
- Root SSH access available initially (will be locked down)
- Domain `app.saziqo.ir` DNS pointing to VPS

**Deliverables:**

- `infra/scripts/provision.sh`:
  - Update OS, install: `curl`, `rsync`, `unzip`, `ufw`, `fail2ban`, `git`, `make`, `jq`, `htop`
  - Install Docker Engine + Docker Compose plugin (official Docker apt repo)
  - Install Caddy (official Caddy apt repo)
  - Create `deploy` user, add to `docker` group, SSH key only auth
  - Create directory tree: `/opt/saziqo-platform/{releases,current,shared/{logs,uploads,postgres-data,redis-data}}`
  - Create systemd unit for Caddy (auto-installed by package; verify enabled)
  - Initial UFW config: allow 22, 80, 443, deny everything else (final hardening in 15D)
  - Log to `/var/log/saziqo-provision.log`
  - Idempotent: safe to re-run
- `docs/server-setup.md` documenting:
  - VPS rental steps
  - Initial SSH access (root → deploy user)
  - DNS configuration
  - Running provision.sh
  - Post-script verification checklist

**Acceptance:**

- Fresh Ubuntu 24.04 → run script → all dependencies installed
- `deploy` user can SSH with key, cannot use password
- Docker and Caddy services running and enabled
- Re-running script produces no errors

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 15A.

Build infra/scripts/provision.sh as a bash script with set -euo pipefail.

Steps:
1. apt-get update && apt-get upgrade -y
2. apt-get install -y curl rsync unzip ufw fail2ban git make jq htop
   ca-certificates gnupg lsb-release
3. Install Docker Engine via official repo:
   - Add Docker GPG key + apt repo
   - apt-get install docker-ce docker-ce-cli containerd.io
     docker-buildx-plugin docker-compose-plugin
4. Install Caddy via official repo:
   - Add Caddy GPG key + apt repo
   - apt-get install caddy
5. Create deploy user:
   - id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy
   - usermod -aG docker deploy
   - mkdir -p /home/deploy/.ssh
   - touch /home/deploy/.ssh/authorized_keys
   - chmod 700 /home/deploy/.ssh
   - chmod 600 /home/deploy/.ssh/authorized_keys
   - chown -R deploy:deploy /home/deploy/.ssh
   - Append message: "Add your SSH public key to
     /home/deploy/.ssh/authorized_keys before disabling root login."
6. Create directory tree:
   - mkdir -p /opt/saziqo-platform/{releases,shared/{logs,uploads,
     postgres-data,redis-data}}
   - chown -R deploy:deploy /opt/saziqo-platform
7. UFW initial config:
   - ufw default deny incoming
   - ufw default allow outgoing
   - ufw allow 22/tcp comment 'SSH'
   - ufw allow 80/tcp comment 'HTTP'
   - ufw allow 443/tcp comment 'HTTPS'
   - ufw --force enable
8. Enable services: systemctl enable docker caddy fail2ban
9. Log everything to /var/log/saziqo-provision.log

Build docs/server-setup.md per the plan.

Verify by reviewing the script logic and documenting how to test on a
disposable VPS before running on production.

Commit as "feat(phase-15A): add vps provisioning script".
```

---

## Phase 15B: Caddyfile + TLS + Security Headers

**Model: 🔴 Opus** | ~150 LOC

**Why Opus:** Caddyfile defines all production behavior. Wrong header = vulnerability.

**Deliverables:**

- `infra/caddy/Caddyfile`:

  ```
  app.saziqo.ir {
      encode gzip zstd

      header {
          Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
          X-Content-Type-Options "nosniff"
          X-Frame-Options "DENY"
          Referrer-Policy "strict-origin-when-cross-origin"
          Permissions-Policy "camera=(), microphone=(), geolocation=()"
          Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.zarinpal.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://www.zarinpal.com"
          -Server
      }

      log {
          output file /var/log/caddy/access.log {
              roll_size 100mb
              roll_keep 10
          }
          format json
      }

      # API → NestJS container on localhost:3001
      handle_path /api/* {
          reverse_proxy localhost:3001
      }

      # Frontend → Next.js container on localhost:3000
      handle {
          reverse_proxy localhost:3000
      }
  }

  # Redirect www to apex
  www.app.saziqo.ir {
      redir https://app.saziqo.ir{uri} permanent
  }
  ```

- `infra/scripts/deploy-caddyfile.sh` — copies Caddyfile to `/etc/caddy/Caddyfile`, validates with `caddy validate`, then reloads Caddy via `systemctl reload caddy`
- CSP note: `'unsafe-inline'` for scripts is required for Next.js's inline runtime; can be tightened with nonces in v1.5

**Acceptance:**

- `caddy validate` on the file passes
- After deploy, `https://app.saziqo.ir` returns frontend
- `https://app.saziqo.ir/api/v1/health` returns API JSON
- `securityheaders.com` grades A or higher
- SSL Labs grade A or A+
- HSTS header preload-eligible

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 15B.

Create infra/caddy/Caddyfile per the plan exactly. Use placeholder
domain app.saziqo.ir; if a different domain is later chosen, update
this file.

Note on CSP: connect-src includes https://api.zarinpal.com because the
NestJS server-side calls to ZarinPal don't need it (server-to-server,
not browser), but if frontend ever directly redirects user to ZarinPal
forms via XHR (it doesn't — uses full-page redirect), we'd need it.
For MVP, include zarinpal in connect-src as defense in depth and
document the rationale.

Build infra/scripts/deploy-caddyfile.sh:
- Bash with set -euo pipefail
- Copy infra/caddy/Caddyfile to /etc/caddy/Caddyfile
- Run: caddy validate --config /etc/caddy/Caddyfile
- If valid: systemctl reload caddy
- Else: exit 1 with clear error
- Log to /var/log/saziqo-caddy-deploy.log

Add to docs/deployment.md a section "TLS and Caddy" explaining:
- First boot: Caddy will provision LE certs automatically once DNS
  resolves to the VPS
- Renewal: automatic via Caddy
- Manual reload: ./infra/scripts/deploy-caddyfile.sh

Commit as "feat(phase-15B): add caddyfile and tls config".
```

---

## Phase 15C: docker-compose.prod.yml + .env.production Template

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Production compose file defines the runtime topology. Wrong = downtime or security exposure.

**Deliverables:**

- `infra/docker/docker-compose.prod.yml`:
  - `api` service:
    - Built from `apps/api/Dockerfile` (multi-stage: builder → runner with `node:20-alpine`)
    - Mounts `/opt/saziqo-platform/shared/uploads` to `/var/saziqo-platform/files`
    - Mounts `/opt/saziqo-platform/shared/logs` to `/var/log/saziqo-api`
    - `restart: unless-stopped`
    - Healthcheck: `curl -f http://localhost:3001/api/v1/health`
    - Reads env from `/opt/saziqo-platform/current/.env.production`
    - Network: internal bridge + exposed only to localhost via `ports: "127.0.0.1:3001:3001"`
  - `web` service:
    - Built from `apps/web/Dockerfile` (Next.js standalone output)
    - Same pattern: localhost-only port 3000, restart, healthcheck on `/`
  - `postgres` service:
    - `postgres:16-alpine`
    - Mounts `/opt/saziqo-platform/shared/postgres-data` to `/var/lib/postgresql/data`
    - Healthcheck via `pg_isready`
    - **Not exposed to host** — only accessible via internal Docker network
  - `redis` service:
    - `redis:7-alpine` with `--requirepass ${REDIS_PASSWORD}` (production must use auth)
    - Mounts `/opt/saziqo-platform/shared/redis-data` to `/data`
    - Healthcheck
    - Not exposed to host
- `apps/api/Dockerfile`:

  ```dockerfile
  # Multi-stage: deps → build → runner
  FROM node:20-alpine AS deps
  RUN corepack enable
  WORKDIR /app
  COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
  COPY apps/api/package.json apps/api/
  COPY packages packages
  RUN pnpm install --frozen-lockfile

  FROM node:20-alpine AS build
  RUN corepack enable
  WORKDIR /app
  COPY --from=deps /app /app
  COPY . .
  RUN pnpm --filter api db:generate && pnpm --filter api build
  # Release build with stripping happens here (Phase 16A)
  RUN pnpm release:build:api

  FROM node:20-alpine AS runner
  WORKDIR /app
  RUN apk add --no-cache curl
  RUN addgroup -S nodejs && adduser -S nodejs -G nodejs
  COPY --from=build --chown=nodejs:nodejs /app/apps/api/dist ./dist
  COPY --from=build --chown=nodejs:nodejs /app/apps/api/node_modules ./node_modules
  COPY --from=build --chown=nodejs:nodejs /app/apps/api/prisma ./prisma
  COPY --from=build --chown=nodejs:nodejs /app/apps/api/package.json ./
  USER nodejs
  EXPOSE 3001
  CMD ["node", "dist/main.js"]
  ```

- `apps/web/Dockerfile`:
  - Similar multi-stage with Next.js standalone output
- `infra/.env.production.template`:
  - All env vars required for production with placeholders
  - Notes: `openssl rand -hex 32` for secrets, populate Kavenegar/ZarinPal credentials when received
- `Makefile` targets for prod:
  - `prod-build` — runs deploy.sh (built in 15G)
  - `prod-logs` — tails Caddy + api + web logs
  - `prod-shell-api` — exec into api container
  - `prod-db-shell` — exec into postgres container

**Acceptance:**

- `docker compose -f infra/docker/docker-compose.prod.yml config` validates
- All services have healthchecks
- No service exposed to public internet (Caddy is the only public surface)
- Postgres + Redis not host-accessible
- Volumes mounted correctly

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 15C.

Build infra/docker/docker-compose.prod.yml per the plan structure.
Verify with `docker compose config` (locally — does not need a running
daemon to validate syntax).

Build apps/api/Dockerfile per the plan multi-stage layout. Note that
Phase 16A's release-strip script must exist before the Dockerfile's
`pnpm release:build:api` step works — for now, that line can call
`pnpm --filter api build` until 16A is done. Add a TODO(phase-16A)
comment.

Build apps/web/Dockerfile similarly: deps → build → runner.
Use Next.js standalone output: COPY .next/standalone, .next/static,
public into runner.

Build infra/.env.production.template with all variables documented:
- Database: DATABASE_URL=postgresql://saziqo:CHANGE_ME@postgres:5432/saziqo
- Redis: REDIS_URL=redis://:CHANGE_ME@redis:6379, REDIS_PASSWORD=CHANGE_ME
- JWT: JWT_SECRET, JWT_REFRESH_SECRET, OTP_SALT (each "openssl rand -hex 32")
- Auth: SUPER_ADMIN_PHONE=+989XXXXXXXXX
- SMS: SMS_PROVIDER=kavenegar, KAVENEGAR_API_KEY, KAVENEGAR_SENDER_LINE
- Payments: PAYMENT_PROVIDER=zarinpal, ZARINPAL_MERCHANT_ID,
  ZARINPAL_CALLBACK_URL=https://app.saziqo.ir/api/v1/payments/callback
- App: NODE_ENV=production, PORT_API=3001
- File storage: FILE_STORAGE_ROOT=/var/saziqo-platform/files,
  MAX_UPLOAD_SIZE_MB=10
- CORS: CORS_ALLOWED_ORIGINS=https://app.saziqo.ir
- Maintenance: MAINTENANCE_MODE=false
- Logging: LOG_LEVEL=info, LOG_FILE=/var/log/saziqo-api/api.log
- Modules: ENABLE_EXAMPLE_MODULE=false (production turns off example)
- Frontend: NEXT_PUBLIC_API_BASE_URL=https://app.saziqo.ir/api/v1

Add Makefile targets per the plan.

Add docs/deployment.md with first-deploy walkthrough.

Commit as "feat(phase-15C): add production docker compose and env template".
```

---

## Phase 15D: Server Hardening (UFW, fail2ban, unattended-upgrades)

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** Security baseline. Anything missed = exposed indefinitely.

**Deliverables:**

- `infra/scripts/harden.sh` (extends provision.sh's UFW basics):
  - SSH config hardening: edit `/etc/ssh/sshd_config`:
    - `PasswordAuthentication no`
    - `PermitRootLogin no`
    - `AllowUsers deploy`
    - `MaxAuthTries 3`
    - `LoginGraceTime 30`
    - `ClientAliveInterval 300`
    - `ClientAliveCountMax 2`
  - Restart sshd
  - fail2ban configuration:
    - `/etc/fail2ban/jail.d/sshd.local` enabling SSH jail with bantime 3600, maxretry 3
    - Restart fail2ban
  - unattended-upgrades:
    - `apt-get install unattended-upgrades`
    - Enable security-only auto-updates via `dpkg-reconfigure --priority=low unattended-upgrades`
    - Configure to email deploy user on upgrade events
  - Log rotation for application logs:
    - `/etc/logrotate.d/saziqo-api`: rotate `/var/log/saziqo-api/*.log` daily, keep 14, compress
    - `/etc/logrotate.d/saziqo-caddy`: handled by Caddy's built-in rotation already, but add as safety
  - Disable unused kernel modules / services (only what's safe)
- `docs/security.md`:
  - What was hardened and why
  - Post-hardening verification checklist:
    - `nmap saziqo.ir` shows only 22, 80, 443
    - SSH password attempt from another machine fails
    - `sudo fail2ban-client status sshd` shows active jail
    - SSL Labs grade A or A+
    - securityheaders.com grade A
  - Incident response basics (how to ban an IP manually, how to read fail2ban logs)

**Acceptance:**

- After running script: SSH password auth disabled
- Port scan shows only 22, 80, 443 open
- fail2ban jail active
- Security updates auto-install nightly
- Log rotation runs daily

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 15D.

Build infra/scripts/harden.sh per the plan. Use sed -i for sshd_config
edits with backup (.bak file).

CRITICAL: the script MUST verify SSH key auth works for deploy user
BEFORE disabling password auth. Add a check: try to read deploy user's
authorized_keys; if empty, abort with "Add SSH key first."

Steps in order:
1. Verify deploy user has SSH key in authorized_keys (abort if not)
2. Backup /etc/ssh/sshd_config to /etc/ssh/sshd_config.bak
3. Apply hardening edits
4. sshd -t (test config)
5. systemctl restart sshd
6. fail2ban config + restart
7. unattended-upgrades install + configure
8. logrotate config files
9. Print success summary with next-steps

Build docs/security.md per the plan with verification commands.

Add to Makefile: make harden (runs harden.sh remotely via ssh deploy@...)

Commit as "feat(phase-15D): add server hardening script".
```

---

## Phase 15E: Backup Script (pg_dump + file snapshot)

**Model: 🔴 Opus** | ~180 LOC

**Why Opus:** Backups untested are not backups. Restore drill is required.

**Deliverables:**

- `infra/scripts/backup.sh`:
  - Runs daily via cron (`/etc/cron.d/saziqo-backup`)
  - Steps:
    1. `pg_dump` the saziqo database via Docker exec into postgres container, output gzipped to `/opt/saziqo-platform/backups/postgres/saziqo-{YYYY-MM-DD}.sql.gz`
    2. Tar + gzip `/opt/saziqo-platform/shared/uploads` to `/opt/saziqo-platform/backups/files/files-{YYYY-MM-DD}.tar.gz`
    3. Upload both to remote object storage (Arvan Object Storage S3-compatible) via `s3cmd` or `rclone`
    4. Local retention: keep last 14 days
    5. Remote retention: keep last 30 days
    6. Email summary on success/failure
- `infra/scripts/backup.sh` reads object storage credentials from `/opt/saziqo-platform/current/.env.production` (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`)
- Add to `.env.production.template`: object storage placeholders
- Lock file `/var/run/saziqo-backup.lock` to prevent concurrent runs

**Acceptance:**

- Manual run produces gzipped Postgres dump and files tarball
- Files uploaded to remote storage
- 15-day-old backup deleted locally
- 31-day-old backup deleted remotely
- Email sent with backup summary

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 15E.

Install rclone on the VPS (add to provision.sh dependencies).

Build infra/scripts/backup.sh:
- Bash with set -euo pipefail
- flock /var/run/saziqo-backup.lock -c '...' to prevent concurrent runs
- Source /opt/saziqo-platform/current/.env.production
- Postgres dump:
  docker exec saziqo-postgres-1 pg_dump -U saziqo saziqo |
    gzip > /opt/saziqo-platform/backups/postgres/saziqo-$(date +%F).sql.gz
- Files tarball:
  tar -czf /opt/saziqo-platform/backups/files/files-$(date +%F).tar.gz \
    -C /opt/saziqo-platform/shared/uploads .
- Upload via rclone:
  rclone copy /opt/saziqo-platform/backups/postgres remote:saziqo-backups/postgres
  rclone copy /opt/saziqo-platform/backups/files remote:saziqo-backups/files
- Local retention: find /opt/saziqo-platform/backups -mtime +14 -delete
- Remote retention: rclone delete --min-age 30d remote:saziqo-backups
- Log to /var/log/saziqo-backup.log
- Email summary via mail command (or skip if SMTP not yet configured;
  for v1, just log)

Add to .env.production.template:
- RCLONE_REMOTE_NAME=arvan
- S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY (rclone reads
  from rclone.conf which is configured separately)

Document rclone setup in docs/operations.md:
- rclone config (interactive)
- Test with rclone lsd remote:

Add cron entry installation to harden.sh:
echo "0 2 * * * deploy /opt/saziqo-platform/current/infra/scripts/backup.sh"
> /etc/cron.d/saziqo-backup

Commit as "feat(phase-15E): add backup script with object storage upload".
```

---

## Phase 15F: Restore Drill Script + Documentation

**Model: 🔴 Opus** | ~150 LOC

**Why Opus:** Untested backups are imaginary. Restore drill must be runnable on demand.

**Deliverables:**

- `infra/scripts/restore-drill.sh`:
  - Spins up a separate Postgres container on a non-production port (5433) named `saziqo-restore-test`
  - Downloads latest Postgres backup from remote storage
  - Restores into the test container via `gunzip | psql`
  - Runs sanity queries: count of users, count of payments, check schema integrity
  - Reports success/failure
  - Tears down the test container
- `docs/operations.md` includes a "Disaster Recovery" section:
  - How to do a full restore from backup (production DB)
  - How to restore files from tarball
  - How to roll back a release using `releases/` symlink pattern (introduced in deploy script 15G)
  - Recovery time objective (RTO) and recovery point objective (RPO) statements:
    - RTO: 2 hours (manual restore)
    - RPO: 24 hours (daily backups)

**Acceptance:**

- Drill script downloads, restores, runs sanity, tears down
- Documented restore procedure tested end-to-end at least once before launch

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 15F.

Build infra/scripts/restore-drill.sh:
- set -euo pipefail
- Check rclone configured
- Download latest postgres backup from remote:saziqo-backups/postgres
  (use ls --max-age 1d, take most recent)
- Spin up test postgres container:
  docker run -d --name saziqo-restore-test \
    -e POSTGRES_PASSWORD=test -e POSTGRES_DB=saziqo_restore \
    -p 5433:5432 postgres:16-alpine
- Wait for healthy via pg_isready loop (max 60s)
- gunzip backup | docker exec -i saziqo-restore-test psql -U postgres saziqo_restore
- Sanity queries via docker exec:
  - SELECT COUNT(*) FROM users
  - SELECT COUNT(*) FROM payment WHERE status = 'SUCCEEDED'
  - SELECT schema_name FROM information_schema.schemata
- Report results
- Cleanup: docker stop saziqo-restore-test && docker rm saziqo-restore-test

Build docs/operations.md "Disaster Recovery" section per the plan.

Add to Makefile: make restore-drill

Commit as "feat(phase-15F): add restore drill script".
```

---

## Phase 15G: Manual Deploy Script (no CI/CD)

**Model: 🟢 Sonnet** | ~150 LOC

**Deliverables:**

- `infra/scripts/deploy.sh`:
  - Runs locally on developer machine (not on VPS)
  - Steps:
    1. Verify on `main` branch with clean working tree
    2. `pnpm install --frozen-lockfile`
    3. `pnpm typecheck && pnpm lint && pnpm test`
    4. `pnpm release:build` (introduced in 16A — runs build + strips CLAUDE.md + comments)
    5. `pnpm audit --audit-level=high` (any high-severity vuln blocks deploy unless `FORCE_DEPLOY=1`)
    6. Build Docker images locally: `docker compose -f infra/docker/docker-compose.prod.yml build`
    7. Save images: `docker save saziqo-api saziqo-web | gzip > release.tar.gz`
    8. rsync over SSH to `deploy@app.saziqo.ir:/opt/saziqo-platform/releases/{timestamp}/`
    9. SSH execute remote deploy command:
       - Load images: `gunzip < release.tar.gz | docker load`
       - Run Prisma migrations: `docker compose run --rm api pnpm --filter api db:migrate-deploy`
       - Atomic switch: `ln -sfn /opt/saziqo-platform/releases/{timestamp} /opt/saziqo-platform/current`
       - Restart compose: `docker compose -f infra/docker/docker-compose.prod.yml up -d`
       - Wait for health on both api and web (max 60s)
       - On health failure: revert symlink to previous release, restart, exit 1
    10. Print success with release timestamp
- Maintains last 5 releases in `/opt/saziqo-platform/releases/` for rollback (older auto-pruned)

**Acceptance:**

- Local script: clean run from `main` branch produces deployed release
- Health failure on remote → automatic rollback to previous release
- Rollback procedure documented (manual `ln -sfn` + restart)

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 15G.

Build infra/scripts/deploy.sh per the plan.

Pre-flight checks:
- git rev-parse --abbrev-ref HEAD == 'main' (else abort)
- git diff --quiet (else abort)
- git diff --cached --quiet (else abort)

Local build steps run via pnpm. Set RELEASE_TIMESTAMP=$(date +%Y%m%d-%H%M%S).

SSH section uses ssh deploy@${DEPLOY_HOST} bash <<'EOF' ... EOF heredoc
to run remote commands. DEPLOY_HOST from env (default app.saziqo.ir).

Health check loop on remote:
for i in 1..30; do
  curl -sf http://localhost:3001/api/v1/health && break || sleep 2
done
[[ $i -eq 30 ]] && rollback

Rollback:
- Read previous release from /opt/saziqo-platform/releases (sorted by
  timestamp, take 2nd-most-recent)
- ln -sfn /opt/saziqo-platform/releases/<prev> /opt/saziqo-platform/current
- docker compose ... up -d --force-recreate
- exit 1 with error

Auto-prune: keep most recent 5 in /opt/saziqo-platform/releases, delete
the rest.

Add to docs/deployment.md:
- Pre-deploy checklist
- How to deploy: ./infra/scripts/deploy.sh
- How to manually rollback if auto-rollback didn't trigger
- How to view logs: make prod-logs

Add to Makefile: make deploy (runs deploy.sh).

Commit as "feat(phase-15G): add manual deploy script with auto-rollback".
```

---

## Test Gate 15: Production Readiness

**Model: 🔴 Opus**

- [ ] provision.sh runs on fresh Ubuntu 24.04 → all dependencies installed
- [ ] harden.sh runs → SSH password auth disabled, fail2ban active, UFW configured
- [ ] Caddyfile validates and reloads
- [ ] DNS resolves; Caddy provisions Let's Encrypt cert automatically
- [ ] docker-compose.prod.yml validates
- [ ] All services start with healthchecks passing
- [ ] Postgres + Redis not exposed to host
- [ ] SSL Labs grade A or A+
- [ ] securityheaders.com grade A or higher
- [ ] backup.sh runs → produces local + remote backups
- [ ] restore-drill.sh runs → restores into test container, sanity queries pass
- [ ] deploy.sh full cycle works
- [ ] Health failure → auto-rollback works
- [ ] Manual rollback documented and tested

---

# Phase Group 16 — Release Pipeline + Quality + Docs

## Phase 16A: release-build.sh — Strip CLAUDE.md Files

**Model: 🔴 Opus** | ~130 LOC

**Why Opus:** Your explicit security requirement. Wrong implementation either ships sensitive context or breaks production.

**Deliverables:**

- `infra/scripts/release-build.sh`:
  - Step 1: Run normal build for both api and web
  - Step 2: Find and delete all `CLAUDE.md` files inside `dist/`, `apps/api/dist/`, `apps/web/.next/`, and any other build output directory
  - Step 3: Find and delete all `*/CLAUDE.md` patterns recursively
  - Step 4: Log deleted files to `release-strip-log.txt` (committed to release artifact for audit)
- Wired into `apps/api/Dockerfile` build stage and `apps/web/Dockerfile` build stage
- `pnpm release:build` script at root that runs the full release build chain

**Acceptance:**

- After release build, `find dist -name CLAUDE.md` returns no results
- `release-strip-log.txt` lists all files removed
- Application still runs correctly (CLAUDE.md files were never imported)

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 16A.

Build infra/scripts/release-build.sh:
- set -euo pipefail
- Run pnpm --filter api build (NestJS compiles to dist)
- Run pnpm --filter web build (Next.js compiles to .next)
- Strip CLAUDE.md:
  - find apps/api/dist -name 'CLAUDE.md' -type f -print -delete >> release-strip-log.txt
  - find apps/web/.next -name 'CLAUDE.md' -type f -print -delete >> release-strip-log.txt
  - (Also scan node_modules — but those are third-party; CLAUDE.md
    inside vendor packages is not ours to strip. Skip.)
- Log: "Stripped N CLAUDE.md files"

Add to root package.json scripts:
- "release:build": "bash infra/scripts/release-build.sh"
- "release:build:api": "pnpm --filter api build && find apps/api/dist
   -name 'CLAUDE.md' -delete"
- "release:build:web": "pnpm --filter web build && find apps/web/.next
   -name 'CLAUDE.md' -delete"

Update Dockerfiles to use release:build:api and release:build:web
respectively (replacing the TODO from Phase 15C).

Verify: after pnpm release:build, find apps/api/dist apps/web/.next
-name CLAUDE.md returns nothing.

Commit as "feat(phase-16A): add release build with claude.md stripping".
```

---

## Phase 16B: Comment-Stripping Post-Processor (CLAUDE: + REVIEW:)

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Stripping comments from compiled JS without breaking pragmas (//@ts-ignore, /_! preserve _/, etc.) requires care.

**Deliverables:**

- `infra/scripts/strip-comments.ts`:
  - Walks `apps/api/dist/**/*.js` and `apps/web/.next/**/*.js` (only non-vendor)
  - For each file:
    - Parses with a TypeScript-aware AST tool (use `acorn` or simpler regex with safety guards)
    - Removes only:
      - Single-line comments matching `// CLAUDE:` or `// REVIEW:`
      - Multi-line comments matching `/* CLAUDE: ... */` or `/* REVIEW: ... */`
    - **Preserves**:
      - `// TODO:` (kept by design)
      - `// SECURITY:` (kept by design)
      - `/*! ... */` license/preserve comments
      - `// @ts-ignore`, `// @ts-expect-error` pragmas
      - `//#` source-mapping pragmas
    - Logs files modified to `comment-strip-log.txt`
  - Run as part of `release-build.sh` after the file deletion step
- Safety: dry-run mode (`--dry-run`) prints what would be stripped without modifying
- Source maps: regenerate after stripping or accept that source maps may be slightly off (acceptable for production where source maps shouldn't be exposed anyway)

**Acceptance:**

- After strip: no `CLAUDE:` or `REVIEW:` strings remain in production JS
- TODO and SECURITY comments preserved
- Pragmas preserved
- Application runs correctly

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 16B.

Install at the workspace root: tsx (to run TS scripts directly without
build).

Build infra/scripts/strip-comments.ts as a TypeScript script runnable
via tsx:
- import { glob } from 'glob' (install)
- import * as fs from 'node:fs'
- For each pattern: 'apps/api/dist/**/*.js', 'apps/web/.next/**/*.js'
  - Skip files in node_modules
  - Read content
  - Apply regex replacements:
    1. Single-line: /^[\t ]*\/\/\s*(CLAUDE|REVIEW):.*$\n?/gm → ''
    2. Multi-line: /\/\*\s*(CLAUDE|REVIEW):[\s\S]*?\*\/\s*\n?/g → ''
  - WARNING: regex on JS source has edge cases (comments inside strings,
    etc.). For MVP, accept the regex approach but document the limitation:
    "Strings containing the literal text '// CLAUDE:' could be falsely
    stripped. The convention is to never write CLAUDE: inside string
    literals; if needed, use 'CLAU' + 'DE:' concatenation."
  - Verify pragmas not removed by checking that // @ts- patterns are
    untouched (write 2-3 unit tests with sample inputs)
  - Write back if changed; log filename
- Log summary: "Stripped CLAUDE/REVIEW comments from N files"

Update infra/scripts/release-build.sh to call this script after the
CLAUDE.md deletion step:
  pnpm tsx infra/scripts/strip-comments.ts

Add unit tests in infra/scripts/__tests__/strip-comments.spec.ts:
- Sample input with CLAUDE comment → output without it
- Sample input with TODO comment → output unchanged
- Sample input with @ts-ignore → output unchanged
- Sample input with /*! license */ → output unchanged

Commit as "feat(phase-16B): add comment stripping post-processor".
```

---

## Phase 16C: Health Endpoint + Structured Pino Logging to File

**Model: 🟢 Sonnet** | ~130 LOC

**Deliverables:**

- `apps/api/src/core/health/health.module.ts` and `health.controller.ts`:
  - `GET /api/v1/health` → returns `{ data: { status: 'ok', uptime, checks: { db, redis } } }`
  - DB check: `prisma.$queryRaw\`SELECT 1\``
  - Redis check: `redis.ping()`
  - If any check fails → returns 503 with `{ error: { code: 'UNHEALTHY', details: { failed: ['db'] } } }`
  - `@Public()` so external monitors can hit it
- `apps/api/src/main.ts` Pino setup updated for production:
  - In production: log to file `/var/log/saziqo-api/api.log` via `pino.destination()` with rotating handled by logrotate (Phase 15D)
  - In dev: pretty-print to stdout via `pino-pretty`
  - Log level from env `LOG_LEVEL` (default `info`)

**Acceptance:**

- `GET /api/v1/health` returns 200 with all checks `ok`
- Stop Postgres → next health call returns 503 with `db: 'failed'`
- Production logs go to file as JSON
- Dev logs are human-readable

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 16C.

Build apps/api/src/core/health/:
- health.module.ts: imports PrismaModule, RedisModule
- health.controller.ts:
  - @Get() @Public()
  - Inject PrismaService, RedisService
  - try prisma.$queryRaw`SELECT 1` (catch → db: 'failed')
  - try redis.ping() (catch → redis: 'failed')
  - Compute overall status: 'ok' if all pass, 'unhealthy' otherwise
  - Return appropriate status code via HttpException for unhealthy

Update apps/api/src/main.ts logger config:
- In production (NODE_ENV === 'production'):
  - logger: nestjs-pino with transport file destination
    pino.destination({ dest: process.env.LOG_FILE ||
    '/var/log/saziqo-api/api.log', sync: false })
  - Level from LOG_LEVEL env (default info)
- In dev:
  - logger: nestjs-pino with pino-pretty
  - Level: debug

Verify:
- /api/v1/health returns 200 with checks
- Stop redis → returns 503 with redis: failed
- Production-mode logs go to file (test by setting NODE_ENV=production
  locally with LOG_FILE=/tmp/test.log)

Commit as "feat(phase-16C): add health endpoint and production logging".
```

---

## Phase 16D: Test Runners (Jest unit + Playwright E2E auth flow)

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Test infrastructure decisions affect every future test. Bad setup = tests not run.

**Deliverables:**

- Unit tests already exist throughout previous phases. This phase formalizes the runner setup.
- `apps/api/jest.config.js` — extends the workspace base, configures coverage thresholds (60% for MVP, raised over time)
- `apps/web/jest.config.js` — same pattern
- Coverage report aggregated via `pnpm coverage` at root (uses Turborepo task graph)
- Playwright setup in `apps/web/playwright.config.ts`:
  - Browsers: chromium only in MVP (firefox + webkit added later)
  - baseURL: from env (`http://localhost:3000` in dev, prod URL in CI)
  - Headless by default
- E2E suite: `apps/web/e2e/auth.spec.ts`:
  - Phone entry → OTP request → read OTP from API log (use a test helper that polls log file or reads from a dev-only endpoint that exposes the last sent OTP — only enabled in `NODE_ENV=test`) → verify → profile completion → dashboard
  - Logout → redirected to login
  - Reload → bootstrap restores session
- `pnpm test:e2e` runs Playwright

**Acceptance:**

- `pnpm test` runs all unit tests across workspaces
- `pnpm coverage` produces aggregated coverage report
- `pnpm test:e2e` runs the full auth flow successfully

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 16D.

Build apps/api/jest.config.js extending packages/config (you may need
to add a jest preset there). Coverage thresholds for branches/functions/
lines/statements: 60% each for MVP.

Build apps/web/jest.config.js similarly with React testing library
support.

Add to root package.json: "coverage": "turbo run coverage"
Add to api/web package.json: "coverage": "jest --coverage"

Install Playwright in apps/web:
- pnpm --filter web add -D @playwright/test
- npx playwright install chromium

Build apps/web/playwright.config.ts per the plan.

Build apps/web/e2e/auth.spec.ts:
- Test 1: Full auth flow
  - Open /login
  - Type Iranian phone
  - Click submit, wait for /login/verify
  - Read OTP from API: hit a NODE_ENV=test-only endpoint
    GET /api/v1/_test/last-otp/:phone (build this endpoint in api,
    gated by config: throws unless NODE_ENV === 'test')
  - Type OTP into the OTP boxes
  - Wait for navigation to /onboarding/profile (new user) or /dashboard
  - Fill profile completion if shown
  - Verify /dashboard renders welcome
- Test 2: Logout
  - From dashboard, open user menu, click logout
  - Verify on /login
- Test 3: Reload preserves session
  - Login
  - Reload page
  - Verify still logged in (no redirect to /login)

Add a NODE_ENV=test-only API endpoint apps/api/src/core/_test/test.controller.ts:
- @Get('_test/last-otp/:phone') @Public()
- Reads from Redis the most recent OTP for the phone (we already store
  hashed in Redis; expose a debug variant that stores the plain code in
  a separate "test-only" key when NODE_ENV=test). CLAUDE: this endpoint
  must be guarded with a conditional that throws if NODE_ENV !== 'test'.
  Production builds reject this.

Add to package.json: "test:e2e": "pnpm --filter web exec playwright test"

Commit as "feat(phase-16D): add jest unit and playwright e2e infrastructure".
```

---

## Phase 16E: Dependency Scanner (npm audit + Trivy)

**Model: 🟢 Sonnet** | ~130 LOC

**Deliverables:**

- `infra/scripts/scan-deps.sh`:
  - `pnpm audit --audit-level=moderate` — fails on moderate or higher
  - Trivy scan of Docker images (after build):
    - `trivy image saziqo-api --severity HIGH,CRITICAL --exit-code 1 --ignore-unfixed`
    - Same for `saziqo-web`
  - Optionally: filesystem scan with `trivy fs .` for misconfigurations
- Wired into `deploy.sh` as a pre-deploy check (configurable to skip via `SKIP_SECURITY_SCAN=1` for emergencies)
- `pnpm scan:deps` script

**Acceptance:**

- Clean codebase → script exits 0
- Adding a vulnerable dependency → script fails with clear output
- Scan results saved to `scan-report.txt`

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 16E.

Add Trivy installation to provision.sh (apt-based install via aquasec
repo).

Build infra/scripts/scan-deps.sh:
- set -euo pipefail
- pnpm audit --audit-level=moderate (continue on warning, fail on
  moderate-or-higher unfixed)
- If Docker images exist locally: trivy image scans for both
- Save full report to scan-report.txt
- Print summary

Add to root package.json: "scan:deps": "bash infra/scripts/scan-deps.sh"

Update deploy.sh to call scan:deps before build (skip if SKIP_SECURITY_SCAN=1
env flag).

Document in docs/security.md "Vulnerability Management":
- Run scan:deps before every deploy
- Triage: high/critical = block, moderate = create issue, low = ignore
- Update dependencies monthly via pnpm update

Commit as "feat(phase-16E): add dependency scanner script".
```

---

## Phase 16F: Docs — Architecture, Module Contract, Auth Flow

**Model: 🟢 Sonnet** | ~200 LOC

**Deliverables:**

- `docs/architecture.md`:
  - System overview (the diagram from system plan)
  - Tech stack table
  - Modular monolith rationale
  - System layer responsibilities
  - Module rules
  - Data flow examples (e.g., "user signs up" → trace through middleware → auth service → users service → audit)
- `docs/module-contract.md`:
  - The PlatformModule interface in detail
  - How to write a new module (step-by-step using `_example` as reference)
  - How modules register routes, permissions, migrations, notifications, admin pages, payment purposes
  - Module isolation rules (no cross-module imports, table prefixing)
  - Migration discipline (append-only)
- `docs/auth-flow.md`:
  - Phone+OTP flow diagram
  - Profile completion gate
  - Session lifecycle (issue, refresh rotation, replay protection)
  - Super-admin bootstrap

**Acceptance:**

- Documents complete, accurate, in English
- A new developer can read these and understand the system in 1 hour

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 16F.

Write docs/architecture.md, docs/module-contract.md, docs/auth-flow.md
per the plan structure. Each file 200-400 lines, English, with diagrams
in mermaid syntax where helpful (no images, just code blocks that GitHub
renders).

Reference the system plan and per-phase docs for source of truth.
Avoid duplicating large code samples — link to source files instead.

Commit as "docs(phase-16F): add architecture, module contract, and auth
flow docs".
```

---

## Phase 16G: Docs — Deployment, Operations, Security

**Model: 🔴 Opus** | ~200 LOC

**Why Opus:** Operational docs are read at 3 AM during incidents. Clarity is critical.

**Deliverables:**

- `docs/deployment.md`:
  - Pre-deploy checklist
  - First-time deploy walkthrough (from blank VPS to live)
  - Subsequent deploy procedure (`make deploy`)
  - Manual rollback procedure
  - How to apply emergency hotfix
- `docs/operations.md`:
  - Daily operations (log review, backup verification)
  - Common tasks: how to add an admin user, how to suspend a user, how to refund a payment
  - Monitoring (UptimeRobot setup deferred to v1.5)
  - Disaster recovery (from Phase 15F)
  - Incident response basics
- `docs/security.md`:
  - Threat model (high level)
  - Hardening checklist (from Phase 15D)
  - Secret rotation procedure
  - Vulnerability management (from Phase 16E)
  - Audit log review cadence
  - Compliance notes (no formal compliance in MVP)

**Acceptance:**

- Documents complete and accurate
- Each procedure is a numbered list executable by an ops person

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 16G.

Write docs/deployment.md, docs/operations.md, docs/security.md per the
plan structure. Each procedure as a numbered list with concrete commands.

Include real command examples, not pseudo-code. Use bash code blocks
with copy-paste-friendly commands.

Cross-reference between docs (e.g., security.md references operations.md
for incident response).

Commit as "docs(phase-16G): add deployment, operations, and security docs".
```

---

## Phase 16H: README + Onboarding Guide

**Model: 🟢 Sonnet** | ~200 LOC

**Deliverables:**

- Root `README.md`:
  - Project description
  - Quick start (clone, install, dev)
  - Tech stack
  - Repository structure overview
  - Links to all docs
  - License (TBD; placeholder for now)
- `docs/onboarding.md`:
  - Day 1 checklist for a new developer:
    - Read CLAUDE.md
    - Clone, install, get dev environment running
    - Create test user, complete OTP flow
    - Read architecture.md
    - Read module-contract.md
  - Day 2-5: pick a small "good first issue" (TBD list)
  - Tools and access checklist

**Acceptance:**

- Fresh developer can clone repo and have dev environment running in <30 minutes following README

**Claude Code prompt:**

```
Read SAZIQO_PLATFORM_SYSTEM_PLAN.md, SAZIQO_PLATFORM_PHASES_1_4.md
through SAZIQO_PLATFORM_PHASES_11_13.md, and SAZIQO_PLATFORM_PHASES_14_16.md
fully. Execute Phase 16H.

Write root README.md per plan: project description, quick start, tech
stack, structure, doc links, license placeholder.

Write docs/onboarding.md as a structured day-by-day onboarding plan for
a new developer joining the project.

Test mentally: would a developer who knows TypeScript but not this
codebase be able to follow the README and have dev environment running
in 30 minutes? If not, refine.

Commit as "docs(phase-16H): add readme and onboarding guide".
```

---

## Test Gate 16: Launch Readiness

**Model: 🔴 Opus**

**Pre-launch checklist:**

- [ ] All 70 development phases complete
- [ ] All 15 prior test gates passed
- [ ] `pnpm release:build` produces clean artifact (no CLAUDE.md, no CLAUDE/REVIEW comments)
- [ ] `pnpm test` and `pnpm test:e2e` both pass
- [ ] `pnpm scan:deps` exits 0
- [ ] All docs complete: architecture, module-contract, auth-flow, deployment, operations, security, onboarding, README
- [ ] Production VPS provisioned and hardened
- [ ] DNS resolves; TLS active; SSL Labs A+
- [ ] securityheaders.com A or higher
- [ ] First production deploy succeeds
- [ ] Restore drill executed successfully against production backup
- [ ] Backup cron active; first daily backup verified in remote storage
- [ ] Super_admin bootstrapped from `SUPER_ADMIN_PHONE` env
- [ ] Health endpoint green for 24+ hours
- [ ] Manual smoke test: signup → profile completion → wallet view → admin login → audit log review → impersonation → end impersonation → logout

**If all green: launch.**

---

# What Comes After Phase Group 16

You now have:

- Module registry with reference example
- Full Next.js frontend (auth, dashboard, settings, admin, impersonation)
- Production-grade Docker Compose stack on hardened Iranian VPS
- Caddy with automatic TLS, security headers, security scanning
- Backup + restore drill + manual deploy with auto-rollback
- Release pipeline that strips CLAUDE.md and CLAUDE/REVIEW comments
- Full test infrastructure (Jest unit + Playwright E2E)
- Complete operational documentation

**The system is launch-ready.**

**Next: business modules.** Each module gets its own plan file (e.g., `agents-module-plan.md`) following the same per-phase executable format. The first module to plan depends on which marketplace you ship first.

**Estimated total work for the entire system layer (Phases 1–16):**

| Track                                      | Phases | Test Gates | Est. LOC    | Est. Time     |
| ------------------------------------------ | ------ | ---------- | ----------- | ------------- |
| 1–4 (Foundation, Auth, RBAC)               | 23     | 4          | ~3,200      | ~14 hours     |
| 5–7 (Users, Audit, Files)                  | 9      | 3          | ~1,600      | ~7 hours      |
| 8–10 (Notifications, Ledger, Payments)     | 13     | 3          | ~2,500      | ~11 hours     |
| 11–13 (Module Registry, Frontend, Auth UI) | 14     | 3          | ~2,500      | ~10 hours     |
| 14–16 (Admin Shell, Production, Release)   | 18     | 3          | ~3,000      | ~13 hours     |
| **Total**                                  | **77** | **16**     | **~12,800** | **~55 hours** |

(LOC slightly higher than the 12,000 estimate from the master plan because per-phase expansion surfaced additional small files.)

Spread across 6–8 Claude Code sessions over 3–4 weeks.
