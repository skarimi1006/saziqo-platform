# Multi-stage build for the NestJS API.
# deps  → installs the full pnpm workspace from a frozen lockfile
# build → runs prisma generate + nest build (and the release-strip step)
# runner → minimal alpine runtime, non-root user, only what main.js needs
#
# Build context is the repo root (set in docker-compose.prod.yml). All
# COPY paths below are repo-rooted.

# ──────────────────────────────────────────────────────────────────────
# deps — install workspace dependencies
# ──────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /app

# Copy lockfile + workspace metadata first so the layer cache survives
# any change to source files. The deps layer only invalidates when one
# of these manifests changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages packages

RUN pnpm install --frozen-lockfile

# ──────────────────────────────────────────────────────────────────────
# build — compile TypeScript + generate Prisma client + release strip
# ──────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app

# Bring node_modules forward from deps.
COPY --from=deps /app /app
COPY . .

# Generate Prisma client into apps/api/node_modules/.prisma, then build.
RUN pnpm --filter api db:generate \
 && pnpm --filter api build

# TODO(phase-16A): Replace with `pnpm release:build:api` once the
# release-strip script exists. That step strips CLAUDE/REVIEW comment
# markers from the compiled JS. For now we ship the dist/ as built.

# ──────────────────────────────────────────────────────────────────────
# runner — minimal runtime
# ──────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# curl needed for the compose healthcheck
RUN apk add --no-cache curl

# Drop privileges — never run prod node as root.
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs

# Bring only what the runtime actually needs:
#   - dist/        (compiled JS)
#   - node_modules (production deps; resolved against the workspace
#                   hoist via the api package's own node_modules)
#   - prisma/     (schema + migrations for `prisma migrate deploy`)
#   - package.json (so pnpm/node can resolve `main` and version)
COPY --from=build --chown=nodejs:nodejs /app/apps/api/dist ./dist
COPY --from=build --chown=nodejs:nodejs /app/apps/api/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/apps/api/prisma ./prisma
COPY --from=build --chown=nodejs:nodejs /app/apps/api/package.json ./

USER nodejs

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "dist/main.js"]
