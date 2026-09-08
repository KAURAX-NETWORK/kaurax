// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title KVSGas
/// @notice The gas schedule of the KAURAX Verifiable Subset.
///
/// @dev Static costs match the EVM's for every opcode the subset covers. Two deliberate
///      divergences, both documented in docs/FAULT_PROOFS.md and both in the direction of
///      charging more rather than less:
///
///        1. No EIP-2929 warm/cold tracking. Every SLOAD is priced cold and every SSTORE is
///           priced as a cold write. Tracking access lists would add a fourth committed
///           structure to the machine state for no gain in what the verifier proves.
///        2. No SSTORE refunds. Refunds are a transaction-level accounting rule, and the
///           subset models a single frame with no transaction wrapper.
///
///      A divergence in either direction would be a soundness bug if the emulator and the
///      verifier disagreed about it. They share this file's constants by construction: the
///      TypeScript emulator's `gas.ts` is generated from the same table and pinned by a
///      differential test.
library KVSGas {
    uint64 internal constant ZERO = 0;
    uint64 internal constant BASE = 2;
    uint64 internal constant VERYLOW = 3;
    uint64 internal constant LOW = 5;
    uint64 internal constant MID = 8;
    uint64 internal constant HIGH = 10;
    uint64 internal constant JUMPDEST = 1;

    uint64 internal constant KECCAK256_BASE = 30;
    uint64 internal constant KECCAK256_WORD = 6;

    uint64 internal constant SLOAD = 2100;
    uint64 internal constant SSTORE_SET = 20000;
    uint64 internal constant SSTORE_RESET = 2900;

    uint64 internal constant MEMORY_WORD = 3;

    /// @notice Total cost of holding `_words` words of memory.
    /// @dev The EVM's own formula: 3w + w²/512. Charged as a delta when memory grows.
    function memoryCost(uint256 _words) internal pure returns (uint256) {
        return MEMORY_WORD * _words + (_words * _words) / 512;
    }

    /// @notice Extra gas owed for growing memory from `_current` to cover `_needed` words.
    function expansionCost(uint256 _current, uint256 _needed) internal pure returns (uint256) {
        if (_needed <= _current) return 0;
        return memoryCost(_needed) - memoryCost(_current);
    }
}
