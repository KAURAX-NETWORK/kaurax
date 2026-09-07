// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Types} from "./Types.sol";

/// @title Hashing
/// @notice Canonical hashing for KAURAX settlement objects. These definitions are
///         consensus-critical: `kaurax-node` reimplements them in TypeScript
///         (blockchain/l3/src/settlement/hashing.ts) and the two MUST agree.
library Hashing {
    /// @notice Version tag for v0 output roots.
    bytes32 internal constant OUTPUT_ROOT_VERSION = bytes32(0);

    /// @notice Commitment to KAURAX L3 state at a point in time.
    /// @dev Mirrors the OP Stack output-root construction, with the withdrawal tree
    ///      root in place of the message-passer storage root.
    function hashOutputRoot(Types.OutputRootProof memory _proof) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(_proof.version, _proof.stateRoot, _proof.withdrawalTreeRoot, _proof.latestBlockHash)
        );
    }

    /// @notice Unique identifier of a withdrawal message. This is the leaf committed to
    ///         the withdrawal Merkle tree on L3 and proven against on L2.
    function hashWithdrawal(Types.WithdrawalTransaction memory _tx) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(_tx.nonce, _tx.sender, _tx.target, _tx.value, _tx.gasLimit, keccak256(_tx.data))
        );
    }

    /// @notice Deterministic identifier of a deposit, used by the node's derivation
    ///         pipeline to build the corresponding L3 system transaction.
    function hashDeposit(Types.DepositTransaction memory _tx, uint256 _logIndex, bytes32 _l2BlockHash)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(_l2BlockHash, _logIndex, _tx.from, _tx.to, _tx.value, _tx.data));
    }
}
