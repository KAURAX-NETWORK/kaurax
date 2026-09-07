// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Types} from "../libraries/Types.sol";

/// @title IKauraxPortal
/// @notice The canonical bridge entry point on the underlying L2.
///
///         L2 -> L3 (deposit):   depositTransaction, derived by kaurax-node into an L3
///                               system transaction. This is also the forced-inclusion
///                               escape hatch: a deposit cannot be censored by the
///                               sequencer without also censoring the L2.
///         L3 -> L2 (withdraw):  proveWithdrawalTransaction, then, after the challenge
///                               window, finalizeWithdrawalTransaction.
interface IKauraxPortal {
    event TransactionDeposited(
        address indexed from, address indexed to, uint256 indexed version, bytes opaqueData
    );
    event WithdrawalProven(bytes32 indexed withdrawalHash, address indexed from, address indexed to);
    event WithdrawalFinalized(bytes32 indexed withdrawalHash, bool success);
    event Paused(address account);
    event Unpaused(address account);

    function depositTransaction(
        address _to,
        uint256 _value,
        uint64 _gasLimit,
        bool _isCreation,
        bytes memory _data
    ) external payable;

    function proveWithdrawalTransaction(
        Types.WithdrawalTransaction memory _tx,
        uint256 _l2OutputIndex,
        Types.OutputRootProof memory _outputRootProof,
        uint256 _withdrawalIndex,
        bytes32[] memory _withdrawalProof
    ) external;

    function finalizeWithdrawalTransaction(Types.WithdrawalTransaction memory _tx) external;

    function paused() external view returns (bool);
    function depositCount() external view returns (uint256);
}
