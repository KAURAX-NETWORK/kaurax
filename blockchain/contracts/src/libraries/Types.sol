// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Types
/// @notice Shared structs for the KAURAX L3 <-> L2 settlement interface.
library Types {
    /// @notice A state commitment for KAURAX, published on the underlying L2.
    struct OutputProposal {
        /// @dev Commitment to the KAURAX L3 state. See Hashing.hashOutputRoot.
        bytes32 outputRoot;
        /// @dev Timestamp of the L2 block in which this proposal was included.
        uint128 timestamp;
        /// @dev KAURAX L3 block number this proposal commits to.
        uint128 l3BlockNumber;
    }

    /// @notice The preimage of an output root. Supplying it proves which L3 state and
    ///         which withdrawal tree a proposal committed to.
    struct OutputRootProof {
        bytes32 version;
        /// @dev State root of the KAURAX L3 block.
        bytes32 stateRoot;
        /// @dev Root of the withdrawal Merkle tree held by L3ToL2MessagePasser.
        bytes32 withdrawalTreeRoot;
        /// @dev Hash of the KAURAX L3 block.
        bytes32 latestBlockHash;
    }

    /// @notice A withdrawal message originated on KAURAX and finalized on the L2.
    struct WithdrawalTransaction {
        uint256 nonce;
        address sender;
        address target;
        uint256 value;
        uint256 gasLimit;
        bytes data;
    }

    /// @notice A deposit derived from the L2 into a KAURAX L3 system transaction.
    struct DepositTransaction {
        address from;
        address to;
        uint256 value;
        uint256 gasLimit;
        bool isCreation;
        bytes data;
    }
}
