# CLAUDE.md — packages/

Shared workspace packages. All private, versioned with `workspace:*`.

| Package             | Phase | Purpose                                                                       |
| ------------------- | ----- | ----------------------------------------------------------------------------- |
| `config`            | 1B ✓  | Shared tsconfig, ESLint, Prettier configs                                     |
| `shared-types`      | 2C    | TypeScript types for API response shapes and entities                         |
| `shared-validators` | 3C    | Zod schemas: phone, national ID, email, currency, pagination                  |
| `persian-utils`     | 3C–3D | Phone normalization, national ID checksum, Jalali display, numeral conversion |
| `ui`                | 16F   | RTL-patched shadcn/ui primitives, brand tokens, consumed by apps/web          |

**Import rule:** `apps/*` and `packages/*` may import from packages listed here.
Packages must not import from `apps/*` or from other packages not listed as their own dependency.
