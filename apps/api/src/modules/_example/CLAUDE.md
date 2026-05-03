# CLAUDE.md — modules/\_example/

**Reference module — do not remove.**

This is a skeleton business module that exercises the full `PlatformModule`
contract end-to-end. When adding a new business module (agents, builders,
templates, …), copy this directory, rename every `example`/`_example`
occurrence to the new module name, and fill in the domain logic.

## How to copy this skeleton

1. Duplicate `apps/api/src/modules/_example/` as `apps/api/src/modules/{name}/`
2. Find-replace `_example` → `{name}` and `Example` → `{CapName}` throughout
3. Pick a version prefix for your DB tables: `{name}_*` (e.g. `agents_listings`)
4. Add the module to `apps/api/src/modules.config.ts` (the ONLY registration file)
5. Start with `enabled: false` and set the env flag to test locally

## File map

| File                    | Purpose                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| `index.ts`              | `PlatformModule` instance — identity, lifecycle hooks, metadata registration |
| `example.module.ts`     | NestJS `@Module()` class returned by `registerNestModule()`                  |
| `example.controller.ts` | REST endpoints; guards + `@RequirePermission` on every handler               |
| `example.service.ts`    | Domain logic; inject core services via constructor                           |

## Module rules (enforced by lint + tests)

1. **No cross-module imports.** Only `core/*` and `common/*` are allowed. Modules
   communicate through the event bus (post-MVP) or by calling core services.
2. **Own your table prefix.** Use `{name}_*` for all Prisma models. Never share
   or touch another module's tables.
3. **Inject, don't reach.** Routes live under `/api/v1/{name}/…`. Guards, audit
   decorators, and idempotency interceptor are inherited globally — just add
   `@RequirePermission` to each handler.

## Enable/disable flag

```
ENABLE_EXAMPLE_MODULE=true   # dev default when var is absent
ENABLE_EXAMPLE_MODULE=false  # production default when var is absent
```

Set to `false` (or leave unset) in production. The `enabled` flag is read
once at process start; changing it requires a restart.
