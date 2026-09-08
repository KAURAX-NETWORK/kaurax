/**
 * @kaurax/kvs — the KAURAX Verifiable Subset.
 *
 * A deterministic execution model, an emulator that produces per-step traces, and the
 * commitments a dispute game narrows over. The on-chain half lives in
 * blockchain/contracts/src/kvs/.
 *
 * READ THIS FIRST: the KVS is a strict subset of the EVM, and KAURAX blocks are not executed
 * on it. KAURAX's engine is `anvil` over the full EVM. This package therefore does not give
 * KAURAX fault proofs over its own state transitions; docs/FAULT_PROOFS.md sets out exactly
 * what is and is not covered.
 */
export * from "./merkle.js";
export * from "./state.js";
export * from "./gas.js";
export * from "./machine.js";
export * from "./trace.js";
export * from "./encode.js";
