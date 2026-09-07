/**
 * ExecutionEngineInterface — the boundary between KAURAX consensus and KAURAX execution.
 *
 * This mirrors the split the OP Stack draws between `op-node` (which decides *what* goes
 * into a block) and `op-geth` (which decides *what that block means*). Keeping it behind
 * an interface is what lets the same sequencer, batcher and proposer drive either the
 * devnet engine or a production `op-geth` over the Engine API.
 */
export type Hex = `0x${string}`;

export interface L3Block {
  number: bigint;
  hash: Hex;
  parentHash: Hex;
  stateRoot: Hex;
  timestamp: bigint;
  gasUsed: bigint;
  gasLimit: bigint;
  baseFeePerGas: bigint | null;
  transactions: Hex[];
}

export interface DepositIntent {
  /** The L3-side sender. Already aliased by the portal when the depositor is a contract. */
  from: Hex;
  /** Target on KAURAX. `null` means contract creation. */
  to: Hex | null;
  /** KAX minted to `from` on L3, backed by value escrowed on the L2. */
  mint: bigint;
  /** Value the L3 transaction itself carries. */
  value: bigint;
  gasLimit: bigint;
  data: Hex;
  /** L2 transaction that produced this deposit, for traceability. */
  l2TxHash: Hex;
  l2LogIndex: number;
  l2BlockNumber: bigint;
}

export interface ExecutionEngine {
  /** Human-readable name of the backing client, for logs and status output. */
  readonly clientName: string;

  start(): Promise<void>;
  stop(): Promise<void>;

  /** Chain ID reported by the engine. Must match the configured KAURAX chain ID. */
  chainId(): Promise<number>;

  /** Forward a user transaction into the engine's pending set, in sequencer order. */
  submitTransaction(rawTx: Hex): Promise<Hex>;

  /**
   * Apply a deposit derived from the L2. The engine mints `mint` to `from` and then
   * executes the transaction as that sender — the same two-step the OP Stack performs for
   * a deposit transaction type.
   */
  applyDeposit(deposit: DepositIntent): Promise<Hex>;

  /** Seal a block over whatever has been submitted since the last call. */
  produceBlock(): Promise<L3Block>;

  getBlockNumber(): Promise<bigint>;
  getBlock(numberOrTag: bigint | "latest"): Promise<L3Block | null>;

  /** Read a contract at a historical block. Used to snapshot the withdrawal tree root. */
  call(to: Hex, data: Hex, blockNumber?: bigint): Promise<Hex>;

  /** Pass through an arbitrary JSON-RPC request. Used by the public RPC facade. */
  request<T = unknown>(method: string, params: unknown[]): Promise<T>;
}
