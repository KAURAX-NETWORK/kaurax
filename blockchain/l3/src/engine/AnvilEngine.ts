/**
 * AnvilEngine — the KAURAX execution engine for the `devnet` profile.
 *
 * `anvil` is run with mining disabled, so it never decides on its own what a block
 * contains. `kaurax-node` submits transactions in the order its sequencer chose and then
 * seals a block explicitly. The relationship is the same one `op-node` has with
 * `op-geth`: consensus decides the payload, execution decides its effect.
 *
 * `anvil` is a full revm-based EVM implementation, so execution, gas accounting, receipts,
 * logs and state roots here are real. What it is not is a production client.
 *
 * This is the ONLY `ExecutionEngine` implementation, and `index.ts` constructs it
 * unconditionally — the profile is not consulted. An earlier version of this comment claimed
 * the `testnet` profile used `op-geth`; no such engine exists in this repository, and the
 * public testnet runs exactly what the devnet runs. `ExecutionEngine` is written to admit a
 * second implementation, which is a different statement from having one.
 *
 * The consequence is not cosmetic: because the engine is an external binary reached over
 * JSON-RPC, it cannot emit a per-instruction execution trace, which is why KAURAX has no
 * fault proof over its own state transitions. See docs/FAULT_PROOFS.md §1.
 */
import {JsonRpcClient} from "./rpc.js";
import type {DepositIntent, ExecutionEngine, Hex, L3Block} from "./types.js";
import {createLogger} from "../log.js";

interface RawBlock {
  number: Hex;
  hash: Hex;
  parentHash: Hex;
  stateRoot: Hex;
  timestamp: Hex;
  gasUsed: Hex;
  gasLimit: Hex;
  baseFeePerGas?: Hex;
  transactions: Hex[];
}

export class AnvilEngine implements ExecutionEngine {
  readonly clientName = "anvil (revm)";

  private readonly rpc: JsonRpcClient;
  private readonly log = createLogger("engine");

  constructor(engineRpcUrl: string) {
    this.rpc = new JsonRpcClient(engineRpcUrl);
  }

  async start(): Promise<void> {
    await this.rpc.waitReady();
    // Belt and braces: the launcher passes --no-mining, but a re-attached engine may not
    // have been started by us.
    await this.rpc.request("evm_setAutomine", [false]);
    await this.rpc.request("evm_setIntervalMining", [0]);
    this.log.info("execution engine ready", {client: this.clientName, url: this.rpc.url});
  }

  async stop(): Promise<void> {
    // The engine process lifetime is owned by the launcher, not by this adapter.
  }

  async chainId(): Promise<number> {
    return Number(BigInt(await this.rpc.request<Hex>("eth_chainId")));
  }

  async submitTransaction(rawTx: Hex): Promise<Hex> {
    return this.rpc.request<Hex>("eth_sendRawTransaction", [rawTx]);
  }

  /**
   * Deposits are applied as the OP Stack applies them: mint to the L3-side sender, then
   * execute the call as that sender. The sender is an address nobody holds a key for when
   * the depositor was a contract (it is aliased), so impersonation here is the engine
   * privilege that stands in for the deposit transaction type.
   */
  async applyDeposit(deposit: DepositIntent): Promise<Hex> {
    const from = deposit.from;

    if (deposit.mint > 0n) {
      const current = BigInt(await this.rpc.request<Hex>("eth_getBalance", [from, "pending"]));
      await this.rpc.request("anvil_setBalance", [from, toHex(current + deposit.mint)]);
    }

    // Gas for the deposit is paid by the protocol, not the depositor: fund the sender for
    // exactly this transaction and let the refund settle back.
    const gasFunding = deposit.gasLimit * 2_000_000_000n;
    const balNow = BigInt(await this.rpc.request<Hex>("eth_getBalance", [from, "pending"]));
    await this.rpc.request("anvil_setBalance", [from, toHex(balNow + gasFunding)]);

    await this.rpc.request("anvil_impersonateAccount", [from]);
    try {
      const tx: Record<string, unknown> = {
        from,
        value: toHex(deposit.value),
        gas: toHex(deposit.gasLimit),
        data: deposit.data,
      };
      if (deposit.to !== null) tx.to = deposit.to;

      const hash = await this.rpc.request<Hex>("eth_sendTransaction", [tx]);
      this.log.info("deposit applied", {
        from,
        to: deposit.to ?? "(create)",
        mint: deposit.mint.toString(),
        l2Tx: deposit.l2TxHash,
        l3Tx: hash,
      });
      return hash;
    } finally {
      await this.rpc.request("anvil_stopImpersonatingAccount", [from]);
    }
  }

  async produceBlock(): Promise<L3Block> {
    await this.rpc.request("evm_mine", []);
    const block = await this.getBlock("latest");
    if (!block) throw new Error("engine produced no block");
    return block;
  }

  async getBlockNumber(): Promise<bigint> {
    return BigInt(await this.rpc.request<Hex>("eth_blockNumber"));
  }

  async getBlock(numberOrTag: bigint | "latest"): Promise<L3Block | null> {
    const tag = numberOrTag === "latest" ? "latest" : toHex(numberOrTag);
    const raw = await this.rpc.request<RawBlock | null>("eth_getBlockByNumber", [tag, false]);
    return raw ? decodeBlock(raw) : null;
  }

  async call(to: Hex, data: Hex, blockNumber?: bigint): Promise<Hex> {
    const tag = blockNumber === undefined ? "latest" : toHex(blockNumber);
    return this.rpc.request<Hex>("eth_call", [{to, data}, tag]);
  }

  async request<T = unknown>(method: string, params: unknown[]): Promise<T> {
    return this.rpc.request<T>(method, params);
  }
}

function decodeBlock(raw: RawBlock): L3Block {
  return {
    number: BigInt(raw.number),
    hash: raw.hash,
    parentHash: raw.parentHash,
    stateRoot: raw.stateRoot,
    timestamp: BigInt(raw.timestamp),
    gasUsed: BigInt(raw.gasUsed),
    gasLimit: BigInt(raw.gasLimit),
    baseFeePerGas: raw.baseFeePerGas ? BigInt(raw.baseFeePerGas) : null,
    transactions: raw.transactions,
  };
}

function toHex(v: bigint): Hex {
  return `0x${v.toString(16)}`;
}
