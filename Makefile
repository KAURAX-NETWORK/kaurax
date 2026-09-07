# KAURAX — an Ethereum Layer-3.
#
#   make devnet     bring up the full three-layer stack
#   make test       run every test suite
#   make help       list all targets

.DEFAULT_GOAL := help
SHELL := /bin/bash

.PHONY: help install build devnet devnet-stop devnet-status explorer test test-contracts \
        test-node test-acceptance typecheck fmt fmt-check lint clean deploy-settlement \
        deploy-examples deploy-ai docker-up docker-down sweep

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install every dependency (pnpm workspaces + forge-std)
	pnpm install
	cd blockchain/contracts && forge install foundry-rs/forge-std --no-git 2>/dev/null || true

build: ## Build contracts and TypeScript packages
	cd blockchain/contracts && forge build
	pnpm --filter @kaurax/config build
	pnpm build

# ----------------------------------------------------------------- devnet --

devnet: ## Start the local devnet (L1 -> L2 -> KAURAX)
	./infra/scripts/devnet/start.sh

devnet-stop: ## Stop the devnet
	./infra/scripts/devnet/stop.sh

devnet-status: ## Three-layer status, read live from RPC
	./infra/scripts/devnet/status.sh

explorer: ## Run the explorer, bridge UI and dashboard on :3000
	pnpm --filter @kaurax/explorer dev

# ------------------------------------------------------------------ tests --

test: test-contracts test-node ## Run contract and node test suites

test-contracts: ## forge test
	cd blockchain/contracts && forge test -vv

test-node: ## Node and SDK unit tests
	pnpm --filter @kaurax/config build
	pnpm test

test-acceptance: ## End-to-end acceptance test (requires a running devnet)
	./tests/acceptance.sh

typecheck: ## Typecheck every TypeScript package
	pnpm --filter @kaurax/config build
	pnpm typecheck
	cd apps/explorer && npx tsc --noEmit

fmt: ## Format Solidity
	cd blockchain/contracts && forge fmt

fmt-check: ## Verify Solidity formatting
	cd blockchain/contracts && forge fmt --check

lint: fmt-check typecheck ## Formatting plus typecheck

# ------------------------------------------------------------- deployment --

deploy-settlement: ## Deploy the settlement contracts to the configured L2
	cd blockchain/contracts && forge script script/DeploySettlement.s.sol:DeploySettlement \
	  --rpc-url $$L2_RPC_URL --broadcast

deploy-examples: ## Deploy the example contracts to KAURAX
	cd blockchain/contracts && forge script script/DeployExamples.s.sol:DeployExamples \
	  --rpc-url $$KAURAX_RPC_URL --broadcast

deploy-ai: ## Deploy the optional AI application layer to KAURAX
	cd blockchain/contracts && forge script script/DeployAILayer.s.sol:DeployAILayer \
	  --rpc-url $$KAURAX_RPC_URL --broadcast

# ----------------------------------------------------------------- docker --

docker-up: ## Bring the stack up with Docker Compose (unverified — see docker-compose.yml)
	docker compose up --build

docker-down: ## Tear the Docker stack down
	docker compose down -v

# ------------------------------------------------------------------ other --

sweep: ## Scan for TODO/FIXME, mock data and hardcoded secrets
	./infra/scripts/security-sweep.sh

clean: ## Remove build output and devnet state
	rm -rf packages/*/dist apps/explorer/.next contracts/out contracts/cache .devnet
