# Key management

KAURAX has three operator identities. Each one signs transactions on the underlying L2, and
each one can do real damage if it is stolen.

| Role | What it signs | What its theft costs you |
|---|---|---|
| `sequencer` | forced-inclusion acknowledgements | an attacker can claim a censored transaction was included when it was not |
| `batcher` | batch submissions to the inbox | an attacker can publish garbage as KAURAX's data availability, or stop publishing |
| `proposer` | output roots to the oracle | an attacker can propose state roots that do not match the chain |

None of these can steal user funds directly — withdrawals need a Merkle proof against a
finalized output root, and the challenge window exists for exactly this reason. But a stolen
proposer key plus a passive challenger is enough to eventually finalize a lie, and a stolen
batcher key is enough to stop the chain.

## Two modes

Set `KAURAX_SIGNER_MODE`.

### `local` — the key is in the node's environment

```
KAURAX_SIGNER_MODE=local
SEQUENCER_PRIVATE_KEY=0x…
```

Correct for a devnet. Wrong for anything else, because the key is readable by anything that
can read the process environment: a shell on the box, a core dump, a leaked deployment
manifest, a compromised dependency that calls `process.env`.

`KAURAX_PROFILE=testnet` refuses to start in this mode with keys set. Override with
`KAURAX_ALLOW_LOCAL_KEYS=true` only if you have decided the risk is acceptable and written
down why.

### `remote` — the node never holds a key

```
KAURAX_SIGNER_MODE=remote
KAURAX_SIGNER_URL=http://127.0.0.1:8555
KAURAX_SIGNER_TOKEN=…                 # openssl rand -hex 32
SEQUENCER_ADDRESS=0x…                 # what the node expects the service to hold
```

The node builds a transaction, serializes it, hashes it, and sends **32 bytes** to a signing
service. The service returns 65 bytes. The private key never crosses that boundary, so
compromising the node does not hand over the sequencer's identity.

The node checks at startup that the service holds the address you said it would. A mismatch
stops the node rather than settling from an unexpected account.

## The signing protocol

Three endpoints. Small enough to reimplement against your own HSM in an afternoon — which is
the point.

```
GET  {url}/health                        -> 200 {"status":"ok","roles":[…]}
GET  {url}/address/{role}                -> {"address":"0x…"}          20 bytes
POST {url}/sign/{role}   {"hash":"0x…"}  -> {"signature":"0x…"}        65 bytes, r‖s‖yParity
```

All but `/health` require `Authorization: Bearer <token>`.

The service signs a **hash**, never a transaction. It has no opinion about what those bytes
mean, which is precisely why it cannot be argued into signing something it misunderstood.
Both `v ∈ {27,28}` and `yParity ∈ {0,1}` are accepted in the reply.

## The reference implementation

`services/signer` implements the protocol. It holds keys in its own memory, read from its
own environment — a real improvement over keys in the node, because the blast radius of a
compromised sequencer no longer includes the signing identity, but it is not an HSM.

```bash
KAURAX_SIGNER_TOKEN=$(openssl rand -hex 32) \
SEQUENCER_PRIVATE_KEY=0x… \
BATCHER_PRIVATE_KEY=0x… \
PROPOSER_PRIVATE_KEY=0x… \
pnpm --filter @kaurax/signer start
```

It binds to `127.0.0.1` and refuses any other interface unless
`KAURAX_SIGNER_ALLOW_PUBLIC=true`. A signing service reachable from the internet is a
private key reachable from the internet.

Run it as a **separate process with a separate environment** from the node. Putting both
sets of variables in one `.env` and sourcing it into both processes recreates exactly the
problem this design removes.

### Going further: KMS or HSM

`services/signer/src/keystore.ts` is the only file that touches key material. Implement the
`Keystore` interface against AWS KMS, GCP KMS, Vault, or a YubiHSM and hand it to
`createSignerServer`. Nothing else in the service changes.

```ts
export interface Keystore {
  roles(): Role[];
  address(role: Role): Hex | null;
  sign(role: Role, hash: Hex): Promise<Hex>;   // 32 bytes in, 65 bytes out
}
```

**No KMS integration ships with KAURAX.** The seam exists and is tested; the provider-specific
implementation does not. Do not read this section as a claim that it does.

Web3Signer already speaks a compatible shape and is a reasonable off-the-shelf choice.

## Rotation

There is no automated rotation, and pretending otherwise would be worse than saying so.

To rotate the **batcher** or **proposer**: stop the node, change the key in the signing
service, update `BATCHER_ADDRESS` / `PROPOSER_ADDRESS`, and register the new address on
chain — `KauraxBatchInbox.setBatcher` (inbox owner) or
`KauraxL2OutputOracle` (challenger). Fund the new address first; a batcher that cannot pay
gas is a chain that cannot publish.

To rotate the **sequencer**: as above, plus `KauraxPortal.setSequencer`, which the guardian
must call. Do it while no forced transaction is pending — the old address cannot acknowledge
after the change, and an unacknowledged forced transaction halts settlement.

All three on-chain changes go through governance once
`infra/scripts/deployment/deploy-governance.sh` has handed over the roles. See
[decentralization.md](decentralization.md).

## What is stored where

| | Node | Signing service |
|---|---|---|
| private keys | never, in `remote` mode | yes |
| role addresses | yes, and verified at startup | yes |
| WAL, derivation checkpoint | yes — needs persistent disk | no |

The node's `KAURAX_WAL_PATH` and `KAURAX_DERIVATION_CHECKPOINT_PATH` must be on storage that
survives a restart. They are not secret, but losing them is not harmless: the checkpoint is
the only durable record of which L2 deposits have already been applied, and without it the
node cannot tell "not yet included" from "already included". It will refuse to start rather
than guess. See [bridge.md](bridge.md).
