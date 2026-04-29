# سازیکو Platform

A self-hosted, modular business platform for Iranian developers, makers, and businesses building with AI — running at `app.saziqo.ir`.

## Quick Start

**Requirements:** Node.js 20+, pnpm 10+, Docker, GNU Make

```bash
# 1. Clone the repository
git clone https://github.com/skarimi1006/saziqo-platform.git
cd saziqo-platform

# 2. Install Node dependencies
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env — at minimum set POSTGRES_PASSWORD and MEILI_MASTER_KEY

# 4. Start dev infrastructure (Postgres, Redis, Meilisearch)
make dev-up

# 5. Verify all services are healthy (wait ~30 seconds after first run)
docker compose -f docker-compose.dev.yml ps
```

### Verify services

```bash
# Postgres
make db-shell                        # opens psql; \q to exit

# Redis
make redis-shell                     # opens redis-cli; PING → PONG; exit to quit

# Meilisearch
curl http://localhost:7700/health    # → {"status":"available"}
```

### Other Make targets

```bash
make dev-logs    # tail all service logs
make dev-down    # stop services (volumes kept)
make dev-reset   # stop + destroy all volumes (full reset)
make help        # list all targets
```

## Tech Stack

| Layer         | Technology                            |
| ------------- | ------------------------------------- |
| Backend       | NestJS (TypeScript)                   |
| Frontend      | Next.js 15 + Tailwind CSS + shadcn/ui |
| Database      | PostgreSQL 16 (self-hosted)           |
| Cache / Queue | Redis 7 + BullMQ (self-hosted)        |
| Search        | Meilisearch (self-hosted)             |
| Auth          | Phone + SMS OTP (no passwords)        |
| Payments      | ZarinPal (abstracted)                 |
| Monorepo      | Turborepo + pnpm workspaces           |
| Container     | Docker + Docker Compose               |
| Reverse Proxy | Caddy                                 |
