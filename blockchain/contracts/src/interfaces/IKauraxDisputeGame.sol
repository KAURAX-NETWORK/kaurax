// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The part of the dispute game the output oracle needs to see.
///
/// @dev Kept to a single question so the oracle does not depend on the game's internals,
///      and so the game can be replaced — by one that ends in a verifier rather than a
///      guardian — without touching the settlement contract.
interface IKauraxDisputeGame {
    /// @return True while an unsettled game exists for this output index.
    function hasLiveGame(uint256 _outputIndex) external view returns (bool);
}
