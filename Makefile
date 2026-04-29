COMPOSE_DEV := docker compose -f docker-compose.dev.yml

.PHONY: dev-up dev-down dev-logs dev-reset db-shell redis-shell

dev-up: ## Start all dev services in the background
	$(COMPOSE_DEV) up -d

dev-down: ## Stop dev services (preserves volumes)
	$(COMPOSE_DEV) down

dev-logs: ## Tail logs for all dev services
	$(COMPOSE_DEV) logs -f

dev-reset: ## Stop dev services and destroy all volumes (full reset)
	$(COMPOSE_DEV) down -v

db-shell: ## Open a psql shell inside the Postgres container
	$(COMPOSE_DEV) exec postgres psql -U saziqo -d saziqo

redis-shell: ## Open a redis-cli shell inside the Redis container
	$(COMPOSE_DEV) exec redis redis-cli

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
