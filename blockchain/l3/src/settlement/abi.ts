/** Minimal ABI fragments for the KAURAX settlement contracts on the underlying L2. */
export const batchInboxAbi = [
  {
    type: "function",
    name: "submitBatch",
    stateMutability: "nonpayable",
    inputs: [
      {name: "_l3StartBlock", type: "uint256"},
      {name: "_l3EndBlock", type: "uint256"},
      {name: "_data", type: "bytes"},
    ],
    outputs: [],
  },
  {type: "function", name: "batchCount", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {
    type: "function",
    name: "lastBatchL3Block",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "uint256"}],
  },
  {
    type: "event",
    name: "BatchSubmitted",
    inputs: [
      {name: "batchIndex", type: "uint256", indexed: true},
      {name: "l3StartBlock", type: "uint256", indexed: true},
      {name: "l3EndBlock", type: "uint256", indexed: true},
      {name: "dataCommitment", type: "bytes32", indexed: false},
      {name: "compressedSize", type: "uint256", indexed: false},
      {name: "submitter", type: "address", indexed: false},
    ],
  },
] as const;

export const outputOracleAbi = [
  {
    type: "function",
    name: "proposeL2Output",
    stateMutability: "payable",
    inputs: [
      {name: "_outputRoot", type: "bytes32"},
      {name: "_l3BlockNumber", type: "uint256"},
      {name: "_l2BlockHash", type: "bytes32"},
      {name: "_l2BlockNumber", type: "uint256"},
    ],
    outputs: [],
  },
  {type: "function", name: "nextBlockNumber", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {type: "function", name: "nextOutputIndex", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {type: "function", name: "outputCount", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {
    type: "function",
    name: "latestBlockNumber",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "finalizationPeriodSeconds",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "getL2Output",
    stateMutability: "view",
    inputs: [{name: "_l2OutputIndex", type: "uint256"}],
    outputs: [
      {
        type: "tuple",
        components: [
          {name: "outputRoot", type: "bytes32"},
          {name: "timestamp", type: "uint128"},
          {name: "l3BlockNumber", type: "uint128"},
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getL2OutputIndexAfter",
    stateMutability: "view",
    inputs: [{name: "_l3BlockNumber", type: "uint256"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "event",
    name: "OutputProposed",
    inputs: [
      {name: "outputRoot", type: "bytes32", indexed: true},
      {name: "outputIndex", type: "uint256", indexed: true},
      {name: "l3BlockNumber", type: "uint256", indexed: true},
      {name: "l2Timestamp", type: "uint256", indexed: false},
    ],
  },
  {type: "function", name: "PROPOSER_BOND", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {
    type: "function",
    name: "isOutputFinalized",
    stateMutability: "view",
    inputs: [{name: "l2OutputIndex", type: "uint256"}],
    outputs: [{type: "bool"}],
  },
  {
    type: "function",
    name: "proposalProposer",
    stateMutability: "view",
    inputs: [{name: "l2OutputIndex", type: "uint256"}],
    outputs: [{type: "address"}],
  },
] as const;

export const portalAbi = [
  {
    type: "function",
    name: "depositTransaction",
    stateMutability: "payable",
    inputs: [
      {name: "_to", type: "address"},
      {name: "_value", type: "uint256"},
      {name: "_gasLimit", type: "uint64"},
      {name: "_isCreation", type: "bool"},
      {name: "_data", type: "bytes"},
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "proveWithdrawalTransaction",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "_tx",
        type: "tuple",
        components: [
          {name: "nonce", type: "uint256"},
          {name: "sender", type: "address"},
          {name: "target", type: "address"},
          {name: "value", type: "uint256"},
          {name: "gasLimit", type: "uint256"},
          {name: "data", type: "bytes"},
        ],
      },
      {name: "_l2OutputIndex", type: "uint256"},
      {
        name: "_outputRootProof",
        type: "tuple",
        components: [
          {name: "version", type: "bytes32"},
          {name: "stateRoot", type: "bytes32"},
          {name: "withdrawalTreeRoot", type: "bytes32"},
          {name: "latestBlockHash", type: "bytes32"},
        ],
      },
      {name: "_withdrawalIndex", type: "uint256"},
      {name: "_withdrawalProof", type: "bytes32[]"},
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "finalizeWithdrawalTransaction",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "_tx",
        type: "tuple",
        components: [
          {name: "nonce", type: "uint256"},
          {name: "sender", type: "address"},
          {name: "target", type: "address"},
          {name: "value", type: "uint256"},
          {name: "gasLimit", type: "uint256"},
          {name: "data", type: "bytes"},
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "forceTransaction",
    stateMutability: "payable",
    inputs: [
      {name: "_to", type: "address"},
      {name: "_value", type: "uint256"},
      {name: "_gasLimit", type: "uint64"},
      {name: "_data", type: "bytes"},
    ],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "acknowledgeForcedTransactions",
    stateMutability: "nonpayable",
    inputs: [{name: "_upToId", type: "uint256"}, {name: "_l3BlockNumber", type: "uint256"}],
    outputs: [],
  },
  {
    type: "function",
    name: "hasOverdueForcedTransactions",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "bool"}],
  },
  {type: "function", name: "oldestForcedDeadline", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {type: "function", name: "pendingForcedCount", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {type: "function", name: "forcedInclusionWindow", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {type: "function", name: "forcedCursor", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {type: "function", name: "forcedTransactionCount", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {
    // Needed to answer "which L2 block must derivation rewind to" after a checkpoint loss.
    type: "function",
    name: "getForcedTransaction",
    stateMutability: "view",
    inputs: [{name: "forcedId", type: "uint256"}],
    outputs: [
      {
        type: "tuple",
        components: [
          {name: "from", type: "address"},
          {name: "to", type: "address"},
          {name: "value", type: "uint256"},
          {name: "gasLimit", type: "uint64"},
          {name: "submittedAtL2Block", type: "uint64"},
          {name: "deadlineL2Block", type: "uint64"},
          {name: "acknowledged", type: "bool"},
        ],
      },
    ],
  },
  {
    type: "event",
    name: "TransactionForced",
    inputs: [
      {name: "forcedId", type: "uint256", indexed: true},
      {name: "from", type: "address", indexed: true},
      {name: "to", type: "address", indexed: true},
      {name: "value", type: "uint256", indexed: false},
      {name: "gasLimit", type: "uint64", indexed: false},
      {name: "data", type: "bytes", indexed: false},
      {name: "deadlineL2Block", type: "uint256", indexed: false},
    ],
  },
  {type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{type: "bool"}]},
  {type: "function", name: "depositCount", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {type: "function", name: "balance", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {
    type: "function",
    name: "provenWithdrawals",
    stateMutability: "view",
    inputs: [{type: "bytes32"}],
    outputs: [
      {name: "outputRoot", type: "bytes32"},
      {name: "timestamp", type: "uint128"},
      {name: "l2OutputIndex", type: "uint128"},
    ],
  },
  {
    type: "function",
    name: "finalizedWithdrawals",
    stateMutability: "view",
    inputs: [{type: "bytes32"}],
    outputs: [{type: "bool"}],
  },
  {
    type: "event",
    name: "TransactionDeposited",
    inputs: [
      {name: "from", type: "address", indexed: true},
      {name: "to", type: "address", indexed: true},
      {name: "version", type: "uint256", indexed: true},
      {name: "opaqueData", type: "bytes", indexed: false},
    ],
  },
  {
    type: "event",
    name: "WithdrawalProven",
    inputs: [
      {name: "withdrawalHash", type: "bytes32", indexed: true},
      {name: "from", type: "address", indexed: true},
      {name: "to", type: "address", indexed: true},
    ],
  },
  {
    type: "event",
    name: "WithdrawalFinalized",
    inputs: [
      {name: "withdrawalHash", type: "bytes32", indexed: true},
      {name: "success", type: "bool", indexed: false},
    ],
  },
] as const;

export const messagePasserAbi = [
  {
    type: "function",
    name: "initiateWithdrawal",
    stateMutability: "payable",
    inputs: [
      {name: "_target", type: "address"},
      {name: "_gasLimit", type: "uint256"},
      {name: "_data", type: "bytes"},
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdrawalTreeRoot",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "bytes32"}],
  },
  {
    type: "function",
    name: "withdrawalCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "uint256"}],
  },
  {type: "function", name: "messageNonce", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {type: "function", name: "totalBurned", stateMutability: "view", inputs: [], outputs: [{type: "uint256"}]},
  {
    type: "event",
    name: "MessagePassed",
    inputs: [
      {name: "nonce", type: "uint256", indexed: true},
      {name: "sender", type: "address", indexed: true},
      {name: "target", type: "address", indexed: true},
      {name: "value", type: "uint256", indexed: false},
      {name: "gasLimit", type: "uint256", indexed: false},
      {name: "data", type: "bytes", indexed: false},
      {name: "withdrawalHash", type: "bytes32", indexed: false},
      {name: "leafIndex", type: "uint256", indexed: false},
    ],
  },
] as const;
