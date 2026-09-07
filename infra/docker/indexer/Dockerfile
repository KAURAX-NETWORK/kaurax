# KAURAX chain indexer.
FROM node:20-bookworm-slim AS build

WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

COPY pnpm-workspace.yaml package.json tsconfig.base.json turbo.json ./
COPY packages/types/package.json    packages/types/
COPY services/indexer/package.json  services/indexer/
RUN pnpm install --filter @kaurax/types --filter @kaurax/indexer

COPY packages/types    packages/types
COPY services/indexer  services/indexer
RUN pnpm --filter @kaurax/types build && pnpm --filter @kaurax/indexer build

# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10004 kaurax
WORKDIR /app

COPY --from=build --chown=kaurax:kaurax /repo/node_modules              ./node_modules
COPY --from=build --chown=kaurax:kaurax /repo/packages                  ./packages
COPY --from=build --chown=kaurax:kaurax /repo/services/indexer          ./services/indexer
COPY --from=build --chown=kaurax:kaurax /repo/package.json              ./
COPY --from=build --chown=kaurax:kaurax /repo/pnpm-workspace.yaml       ./

USER kaurax
EXPOSE 7301

HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=4 \
  CMD curl -fsS http://127.0.0.1:7301/health || exit 1

# Migrations run on start, inside the indexer process, so the schema is always applied
# exactly once and before any write.
CMD ["node", "services/indexer/dist/index.js"]
