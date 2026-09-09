// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ReentrancyGuard
/// @notice Refuses a nested call into any function marked `nonReentrant`.
///
/// @dev Transient storage (EIP-1153), which `foundry.toml` enables by targeting cancun. The
///      flag is cleared by the EVM when the transaction ends, so there is no path — revert,
///      out-of-gas or otherwise — that leaves a contract permanently locked, which is the
///      one serious failure mode of a storage-backed guard.
abstract contract ReentrancyGuard {
    error Reentrancy();

    bool private transient _entered;

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }
}
