# KAURAX backend API.
FROM node:20-bookworm-slim AS build

WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

COPY pnpm-workspace.yaml package.json tsconfig.base.json turbo.json ./
COPY packages/types/package.json packages/types/
COPY services/api/package.json   services/api/
RUN pnpm install --filter @kaurax/types --filter @kaurax/api

COPY packages/types packages/types
COPY services/api   services/api
RUN pnpm --filter @kaurax/types build && pnpm --filter @kaurax/api build

# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# This process holds the xKiro API key and the database credentials.
RUN useradd --create-home --uid 10003 kaurax
WORKDIR /app

COPY --from=build --chown=kaurax:kaurax /repo/node_modules        ./node_modules
COPY --from=build --chown=kaurax:kaurax /repo/packages            ./packages
COPY --from=build --chown=kaurax:kaurax /repo/services/api        ./services/api
COPY --from=build --chown=kaurax:kaurax /repo/package.json        ./
COPY --from=build --chown=kaurax:kaurax /repo/pnpm-workspace.yaml ./

USER kaurax
EXPOSE 4000

# Liveness only: a full /api/health depends on the database and indexer, and Docker
# restarting the API because PostgreSQL is slow to start would be the wrong response.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/api/health/live || exit 1

CMD ["node", "services/api/dist/index.js"]
