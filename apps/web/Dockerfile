# Multi-stage build for the Next.js 15 web app.
# deps  → installs the full pnpm workspace from a frozen lockfile
# build → builds the standalone Next.js bundle
# runner → copies only standalone server, public/, and static assets
#
# Build context is the repo root (set in docker-compose.prod.yml). All
# COPY paths below are repo-rooted.
#
# next.config.mjs sets `output: 'standalone'` and `outputFileTracingRoot`
# to the repo root, so the build emits a self-contained server bundle at
# apps/web/.next/standalone/ that includes only the deps actually used
# at runtime.

# ──────────────────────────────────────────────────────────────────────
# deps — install workspace dependencies
# ──────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages packages

RUN pnpm install --frozen-lockfile

# ──────────────────────────────────────────────────────────────────────
# build — compile Next.js to standalone output
# ──────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /app

COPY --from=deps /app /app
COPY . .

# NEXT_PUBLIC_* must exist at build time because Next.js inlines them
# into the client bundle. Defaults to the production URL; the
# docker-compose build arg overrides per environment.
ARG NEXT_PUBLIC_API_BASE_URL=https://app.saziqo.ir/api/v1
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

RUN pnpm --filter web build

# ──────────────────────────────────────────────────────────────────────
# runner — standalone Next.js server (~150MB image)
# ──────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# wget is on busybox by default for healthchecks — no extra apk needed.

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# Copy the standalone server bundle. The standalone build emits
# everything into apps/web/.next/standalone/ following the original
# repo layout (so server.js sits at apps/web/server.js inside it).
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
