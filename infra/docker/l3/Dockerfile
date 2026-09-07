# KAURAX L3 node — sequencer, derivation, batcher, proposer and public RPC.
FROM node:20-bookworm-slim AS build

WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# Manifests first: dependency installation is cached until a package.json changes.
COPY pnpm-workspace.yaml package.json tsconfig.base.json turbo.json ./
COPY packages/config/package.json packages/config/
COPY packages/types/package.json  packages/types/
COPY blockchain/l3/package.json   blockchain/l3/
# The node dev-depends on the reference signing service, because its signer tests exercise
# the real service over a real socket rather than a mock. pnpm resolves workspace
# devDependencies even when it will not build them, so the manifest has to be here.
COPY services/signer/package.json services/signer/
RUN pnpm install --filter @kaurax/config --filter @kaurax/types --filter @kaurax/l3

COPY packages/config packages/config
COPY packages/types  packages/types
COPY blockchain/l3   blockchain/l3
RUN pnpm --filter @kaurax/config build \
 && pnpm --filter @kaurax/types build \
 && pnpm --filter @kaurax/l3 build

# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# The node holds sequencer, batcher and proposer keys. It has no reason to be root.
RUN useradd --create-home --uid 10001 kaurax
WORKDIR /app

COPY --from=build --chown=kaurax:kaurax /repo/node_modules        ./node_modules
COPY --from=build --chown=kaurax:kaurax /repo/packages            ./packages
COPY --from=build --chown=kaurax:kaurax /repo/blockchain/l3       ./blockchain/l3
COPY --from=build --chown=kaurax:kaurax /repo/package.json        ./
COPY --from=build --chown=kaurax:kaurax /repo/pnpm-workspace.yaml ./

USER kaurax

# 8420 JSON-RPC, 8421 WebSocket, 7300 metrics.
EXPOSE 8420 8421 7300

HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=4 \
  CMD curl -fsS -X POST http://127.0.0.1:8420 \
      -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' | grep -q result || exit 1

CMD ["node", "blockchain/l3/dist/cli.js"]
