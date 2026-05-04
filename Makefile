COMPOSE_DEV  := docker compose -f docker-compose.dev.yml
COMPOSE_PROD := docker compose -f infra/docker/docker-compose.prod.yml --env-file /opt/saziqo-platform/current/.env.production

.PHONY: dev-up dev-down dev-logs dev-reset db-shell redis-shell \
        prod-build prod-logs prod-shell-api prod-db-shell help

dev-up: ## Start all dev services in the background
	$(COMPOSE_DEV) up -d

dev-down: ## Stop dev services (preserves volumes)
	$(COMPOSE_DEV) down

dev-logs: ## Tail logs for all dev services
	$(COMPOSE_DEV) logs -f

dev-reset: ## Stop dev services and destroy all volumes (full reset)
	$(COMPOSE_DEV) down -v

db-shell: ## Open a psql shell inside the dev Postgres container
	$(COMPOSE_DEV) exec postgres psql -U saziqo -d saziqo

redis-shell: ## Open a redis-cli shell inside the dev Redis container
	$(COMPOSE_DEV) exec redis redis-cli

# ─── Production targets — run on the VPS as the deploy user ──────────────────
# `prod-build` is a thin alias today; the full deploy.sh lands in Phase 15G.

prod-build: ## Build & (re)start the production stack via deploy.sh (15G)
	@if [ -x infra/scripts/deploy.sh ]; then \
		bash infra/scripts/deploy.sh; \
	else \
		echo "infra/scripts/deploy.sh not yet implemented (Phase 15G)."; \
		echo "Falling back to: docker compose build && up -d"; \
		$(COMPOSE_PROD) build && $(COMPOSE_PROD) up -d; \
	fi

prod-logs: ## Tail Caddy + api + web logs together
	@echo "── caddy access log ──────────────────────────────────────────"
	@sudo tail -n 50 -F /var/log/caddy/access.log &
	@echo "── api + web container logs ──────────────────────────────────"
	$(COMPOSE_PROD) logs -f api web

prod-shell-api: ## Exec into the api container as nodejs
	$(COMPOSE_PROD) exec api sh

prod-db-shell: ## Open a psql shell inside the prod Postgres container
	$(COMPOSE_PROD) exec postgres psql -U $${POSTGRES_USER:-saziqo} -d $${POSTGRES_DB:-saziqo}

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
