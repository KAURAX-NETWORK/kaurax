# One-shot: deploy the KAURAX settlement contracts to the configured L2 and install the
# L3 predeploys into the execution engine. Runs to completion and exits.
FROM ghcr.io/foundry-rs/foundry:v1.5.1 AS contracts
WORKDIR /repo/blockchain/contracts
COPY blockchain/contracts/ ./
RUN forge build

# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

COPY --from=ghcr.io/foundry-rs/foundry:v1.5.1 /usr/local/bin/forge /usr/local/bin/forge
COPY --from=ghcr.io/foundry-rs/foundry:v1.5.1 /usr/local/bin/cast  /usr/local/bin/cast

WORKDIR /repo
COPY pnpm-workspace.yaml package.json tsconfig.base.json turbo.json ./
COPY packages/ packages/
COPY infra/scripts/ infra/scripts/
COPY blockchain/chain/ blockchain/chain/
COPY --from=contracts /repo/blockchain/contracts /repo/blockchain/contracts

RUN pnpm install --filter @kaurax/config

CMD ["bash", "infra/scripts/deployment/deploy-contracts.sh"]
