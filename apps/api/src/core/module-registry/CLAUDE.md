# CLAUDE.md — core/module-registry/

The module registry is the contract between the system core and every
business module (`agents`, `builders`, `templates`, `tools`, …).

## Stability

The `PlatformModule` interface in `types.ts` is **stable**. Any breaking
change requires a coordinated module version bump and migration of every
module currently in `apps/api/src/modules.config.ts`. Adding optional
fields (with default behavior) is non-breaking; renaming or removing
required fields is breaking.

## Module isolation rules

1. **Modules MUST NOT import from other modules.** A module imports only
   from `core/*` and `common/*`. The lint configuration (Phase 14C will
   add this rule) enforces it. If module B needs behavior from module A,
   the behavior belongs in `core/*` or A exposes it through a stable
   notification / payment-purpose / event channel.
2. **Modules own their table prefix.** `agents_*` belongs to the agents
   module exclusively. The Prisma multi-file schema layout (Phase 11B+)
   isolates each module's `.prisma` partial. No core table is prefixed.
3. **Modules call core services directly.** In MVP there is no event
   bus — `ModuleDeps` injects concrete services (`payments`, `ledger`,
   `notifications`, …) and modules call them by name. The event bus
   listed in the system plan is deferred to a post-MVP phase.

## Registry behavior

`ModuleRegistryService.register()` stores a module instance in memory.
The Phase 11B loader reads `modules.config.ts` once at boot and calls
`register()` per entry, then runs the four merge methods:

- `mergePermissions()` — upserts `Permission` rows and creates
  `RolePermission` links for any `defaultRoles` that already exist
  (role seeding remains owned by Phase 4D).
- `mergeNotificationTypes()` — calls `NotificationsService.registerType`
  for each module-supplied type. Module types layer on top of the
  static `NOTIFICATION_TEMPLATES` catalog and override on collision.
- `mergeAdminPages()` — returns a sorted list (by `order`, then
  `titleFa`) for the admin shell to render its sidebar.
- `mergePaymentPurposes()` — collects every module's payment purposes
  and hands them to `PaymentsService.registerAllowedPurposes()`. The
  service combines them with the core purpose list (`wallet_topup`)
  for its allow-list check.

All four merge methods are idempotent — calling them twice produces
the same database / in-memory state.
