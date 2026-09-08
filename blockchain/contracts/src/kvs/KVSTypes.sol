// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title KVSTypes
/// @notice The machine state of the KAURAX Verifiable Subset, and its commitment.
///
/// @dev The KVS is a strict subset of the EVM: identical opcode bytes, identical stack
///      semantics and identical static gas costs for everything it covers. It is not a new
///      virtual machine, and it is not the EVM. What it does not cover is enumerated in
///      docs/FAULT_PROOFS.md and rejected at runtime as an exceptional halt rather than
///      silently approximated.
///
///      Every field here is committed. A prover cannot alter one without changing the state
///      hash, and the dispute game only ever compares state hashes.
library KVSTypes {
    // -------------------------------------------------------------- tree heights --

    /// @notice 1024 stack slots — the EVM's own limit.
    uint256 internal constant STACK_HEIGHT = 10;

    /// @notice 65536 words of memory (2 MiB). Beyond this is an exceptional halt, not a
    ///         silent wrap: gas would price it out long before, but the bound is explicit.
    uint256 internal constant MEMORY_HEIGHT = 16;

    /// @notice Storage is keyed by the 256 bits of `keccak256(slot)`, so the tree is a
    ///         full-depth sparse tree. Proofs are 256 siblings, most of them zero hashes.
    uint256 internal constant STORAGE_HEIGHT = 256;

    // -------------------------------------------------------------------- status --

    uint8 internal constant RUNNING = 0;
    uint8 internal constant STOPPED = 1;
    uint8 internal constant REVERTED = 2;
    uint8 internal constant HALTED = 3;

    // ------------------------------------------------------------- halt reasons --

    uint8 internal constant HALT_NONE = 0;
    uint8 internal constant HALT_STACK_UNDERFLOW = 1;
    uint8 internal constant HALT_STACK_OVERFLOW = 2;
    uint8 internal constant HALT_OUT_OF_GAS = 3;
    uint8 internal constant HALT_INVALID_JUMP = 4;
    uint8 internal constant HALT_INVALID_OPCODE = 5;
    uint8 internal constant HALT_UNSUPPORTED_OPCODE = 6;
    uint8 internal constant HALT_UNALIGNED_MEMORY = 7;
    uint8 internal constant HALT_MEMORY_OUT_OF_RANGE = 8;

    /// @notice One machine configuration, fully committed.
    ///
    /// @dev `codeHash` is `keccak256(code)`. The code itself travels in the step proof and
    ///      is checked against this — a Merkleized code commitment would scale better and is
    ///      named as future work in the documentation rather than pretended here.
    struct MachineState {
        uint64 pc;
        uint64 gas;
        bytes32 codeHash;
        bytes32 stackRoot;
        uint16 stackSize;
        bytes32 memRoot;
        /// @dev Memory is measured in 32-byte words, as the EVM prices it.
        uint32 memWords;
        bytes32 storageRoot;
        uint8 status;
        uint8 halt;
    }

    /// @notice The commitment the dispute game compares.
    ///
    /// @dev `abi.encode`, not `encodePacked`: the fields are of mixed width, and packed
    ///      encoding of adjacent short integers is ambiguous — two different states could
    ///      hash alike, which in a fault proof means a prover choosing which one it meant
    ///      after the fact.
    function hashState(MachineState memory _s) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                _s.pc,
                _s.gas,
                _s.codeHash,
                _s.stackRoot,
                _s.stackSize,
                _s.memRoot,
                _s.memWords,
                _s.storageRoot,
                _s.status,
                _s.halt
            )
        );
    }

    /// @notice True when the machine has finished and every later step repeats it.
    /// @dev Terminal states self-loop. A trace is padded to a power of two so it can be
    ///      Merkleized, and padding must not be a state a prover can choose freely.
    function isTerminal(MachineState memory _s) internal pure returns (bool) {
        return _s.status != RUNNING;
    }
}
