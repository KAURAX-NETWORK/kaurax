# AI Layer

KAURAX includes an **optional** application layer for AI services. It is application
contracts on an EVM chain, not a protocol feature, and it is not required by anything else
in the system.

## What belongs on chain, and what does not

**Inference does not happen on chain.** It cannot, at any useful scale, and pretending
otherwise would be dishonest. What a chain is genuinely good at is the surrounding
coordination:

| On chain | Off chain |
|---|---|
| Identity — who is this provider or agent | Model weights |
| Authorization — who may call what | Inference execution |
| Payment and settlement | Prompt and response content |
| Reputation metadata — attestations, counts | Result verification |
| Service discovery | Serving infrastructure |

```
AI provider
    │  registers a service, sets a price
    ▼
KAURAX  ── AIServiceRegistry ── AIAgentRegistry
    │            │
    │            ▼
    │       payment escrow / release
    ▼
application  ── consumes the service off chain, settles on chain
```

## Contracts

`blockchain/contracts/src/ai/`:

| Contract | Responsibility |
|---|---|
| `AIServiceRegistry` | Providers register services: metadata URI, price per call, active flag |
| `AIAgentRegistry` | Agents register an identity and an owner, and are authorized to spend |
| `AIPayments` | Escrowed, per-job payment: fund → deliver → release or refund |

## Honest limits

- **No oracle, no verification.** The chain cannot tell whether a provider actually served
  a request. `AIPayments` escrows funds and releases them on the consumer's acknowledgement
  or a timeout; it does not adjudicate quality or delivery.
- **Reputation is metadata, not proof.** Counters and URIs, recorded on chain. Nothing
  attests that the underlying work happened.
- **No inference, no model hosting, no data storage.** KAURAX stores pointers and money.
- **Unaudited, and unused.** No AI service is deployed on any KAURAX network. The registry
  is empty, and the explorer will say so.

## Why an L3 for this

Coordination workloads are high-frequency and low-value-per-call: an agent settling
thousands of small payments needs blockspace that is cheap and not contended by unrelated
applications. That is the case for an application-specific L3 generally, and it applies here
as well as anywhere.

It is a reason to build on an L3. It is not evidence that anyone has.
