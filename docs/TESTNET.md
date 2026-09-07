# Running a KAURAX node

Every command here was run. Where output is shown, it is real output.

---

## What you are running, and what you are not

KAURAX is a **rollup**, and that determines what a node is.

| | KAURAX | A validator chain |
|---|---|---|
| Who orders transactions | one sequencer | a validator set, by consensus |
| How your node gets blocks | derives them from the L2 | gossips them over p2p |
| What makes it hard to cheat | data availability, forced inclusion, settlement | stake, slashing, quorum |
| What your node does | verifies and serves | votes |

**There are no validators to run.** There is no consensus to join and no peer-to-peer
network to peer with. A KAURAX node reads the L2 and rebuilds the chain from data published
there. That is the design, not a missing feature — and it is why the explorer's validators
page says "No validator data exists for this network" rather than inventing some.

If you want the property validators normally provide — nobody can quietly rewrite history —
KAURAX gets it from a different place: every block is published to the L2 as calldata, and
anyone can rebuild the chain from it. `tests/acceptance.ts` does exactly that.

---

## Requirements

- Docker and Docker Compose
- 4 vCPU, 8 GB RAM, 80 GB disk (see `infra/upcloud/README.md`)
- An L2 RPC endpoint, or the bundled stand-in

---

## Quickest path: the whole stack on one machine

```bash
git clone https://github.com/KAURAX-NETWORK/kaurax.git
cd kaurax
cp .env.example .env
```

Generate a mnemonic for the local chains and put it in `.env` as `KAURAX_DEV_MNEMONIC`:

```bash
cast wallet new-mnemonic
```

> Do not use the published Anvil mnemonic. If this endpoint is reachable from the internet,
> that hands the batcher key to anyone who wants it.

Then:

```bash
docker compose -f docker-compose.yml -f docker-compose.devnet.yml up -d l1 l2 postgres l3-engine
docker compose -f docker-compose.yml -f docker-compose.devnet.yml up bootstrap
```

`bootstrap` deploys the settlement contracts to the L2 and installs the KAURAX predeploys,
then exits. Copy the addresses it prints into `.env`:

```
KAURAX_PORTAL_ADDRESS=0x…
KAURAX_OUTPUT_ORACLE_ADDRESS=0x…
KAURAX_BATCH_INBOX_ADDRESS=0x…
KAURAX_L2_BRIDGE_ADDRESS=0x…
```

Start the rest:

```bash
docker compose -f docker-compose.yml -f docker-compose.devnet.yml up -d kaurax-l3 indexer api nginx
docker compose ps
```

All eight containers should report healthy.

---

## Against a real L2

Same, minus the stand-ins. Set the L2 in `.env`:

```bash
L2_RPC_URL=https://sepolia.base.org
L2_CHAIN_ID=84532
LOCAL_DEV_SETTLEMENT=false
KAURAX_PROFILE=testnet
```

Deploy the settlement contracts:

```bash
cd blockchain/contracts
KAURAX_STARTING_BLOCK=$(cast block-number --rpc-url $KAURAX_RPC_URL) \
PROPOSER_BOND=100000000000000000 \
forge script script/DeploySettlement.s.sol:DeploySettlement --rpc-url $L2_RPC_URL --broadcast
```

> `KAURAX_STARTING_BLOCK` matters. It defaults to 1, and against a chain already producing
> blocks the proposer will ask the execution engine for state thousands of blocks back and
> every proposal will fail with `BlockOutOfRangeError`. Anchor it at the current head.

The sequencer, batcher and proposer accounts need gas **on the L2**, and the proposer needs
`PROPOSER_BOND` per proposal on top.

---

## Dispute game

```bash
KAURAX_OUTPUT_ORACLE_ADDRESS=0x… \
KAURAX_GUARDIAN=0x…              # the multisig, not an EOA
DISPUTE_TRANSFER_CHALLENGER=true \
forge script script/DeployDisputeGame.s.sol:DeployDisputeGame --rpc-url $L2_RPC_URL --broadcast
```

This wires `setDisputeGame` before `setChallenger`, and the order is not cosmetic:
`setDisputeGame` is challenger-only, so handing the role over first leaves the oracle
permanently unable to learn about the game and finalization silently stays a bare timer.

**The guardian decides every dispute.** See `docs/DISPUTE_GAME.md`.

---

## Operator keys

The devnet keeps keys in `.env`. A public deployment should not:

```bash
KAURAX_SIGNER_TOKEN=$(openssl rand -hex 32) \
SEQUENCER_PRIVATE_KEY=0x… BATCHER_PRIVATE_KEY=0x… PROPOSER_PRIVATE_KEY=0x… \
pnpm --filter @kaurax/signer start
```

```bash
KAURAX_SIGNER_MODE=remote
KAURAX_SIGNER_URL=http://127.0.0.1:8555
KAURAX_SIGNER_TOKEN=…
SEQUENCER_ADDRESS=0x…   # startup fails if the service holds a different one
```

The node then never holds a key. See `docs/key-management.md`.

---

## Using it

```bash
pnpm --filter @kaurax/cli build
export KAURAX_RPC_URL=https://kaurax.network/rpc
export KAURAX_API_URL=https://kaurax.network

kaurax wallet create mykey          # KAURAX_PASSPHRASE unlocks it
kaurax faucet                       # 100 KAX, cooldown per address and per IP
kaurax wallet balance
kaurax wallet send 0xRecipient 1
kaurax tx status 0x…
kaurax network status
```

Real output from `wallet send`:

```
from     0x85848cac349C8aaC1d676a0A122555DbB93A304a
to       0x19e9eE78dD3c1b56554f2ffFB80416DeacDf2422
amount   25 KAX
sending…
hash     0x889064a180d00b85d216359db65aef7c043ef8ccc512f17eda4a0e025c2178ae
waiting for inclusion…
block    6979
gas used 21000
status   success
```

Keys are encrypted with scrypt + AES-256-GCM in `~/.kaurax/keys.json`, mode 600. That is
right for a token with no value and wrong for one with any.

### MetaMask

```
Network name     KAURAX Testnet
RPC URL          https://kaurax.network/rpc
Chain ID         8420
Currency symbol  KAX
Explorer         https://kaurax.network/explorer
```

`kaurax wallet add` prints these from the live network.

---

## Health, logs, monitoring

```bash
curl https://kaurax.network/api/health          # rpc, database, indexer — 200 or 503
curl https://kaurax.network/api/health/ready    # readiness; 503 while draining
curl http://127.0.0.1:7300/metrics              # Prometheus, node-internal

docker compose logs -f kaurax-l3
docker compose ps
```

`/api/health` returns 503 when any dependency is down. It does not report "ok" because a
process is running.

---

## Failure behaviour

| If this dies | What happens |
|---|---|
| Sequencer | Block production stops. The write-ahead log preserves sealed-but-unbatched blocks; on restart they are recovered and batched |
| Batcher | Blocks are produced but not published. Data availability degrades until it resumes; nothing is lost |
| Proposer | No new output roots, so withdrawals stall. The chain keeps running |
| Indexer | History queries fail; the chain and RPC are unaffected. It resumes from its checkpoint |
| API | Frontends report the API unreachable. The RPC is unaffected |
| L2 unavailable | Deposits stop being derived and batches cannot be submitted. The sequencer keeps producing; settlement resumes when the L2 returns |

The derivation checkpoint is the one piece of state that must survive. Without it the node
cannot distinguish an already-applied deposit from a new one, and **it refuses to start
rather than guess**.

---

## Tests

```bash
cd blockchain/contracts && forge test     # 262
pnpm test                                 # 121, 25 packages
./tests/acceptance.sh                     # deposit -> batch -> rebuild from L2 calldata
./tests/e2e-testnet.sh                    # wallet -> tx -> block -> state -> confirmation
./tests/live-check.sh                     # the deployed site, by content
```
