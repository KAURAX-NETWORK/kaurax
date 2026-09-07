// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IForcedInclusion
/// @notice The portal's view of forced transactions, as the output oracle needs it.
/// @dev Declared separately so the oracle can depend on the portal without the two
///      contracts importing each other.
interface IForcedInclusion {
    /// @notice True when a forced transaction has gone unacknowledged past its deadline.
    function hasOverdueForcedTransactions() external view returns (bool);

    /// @notice The L2 block by which the oldest unacknowledged forced transaction is due.
    ///         Returns 0 when none is pending.
    function oldestForcedDeadline() external view returns (uint256);

    function pendingForcedCount() external view returns (uint256);
}
