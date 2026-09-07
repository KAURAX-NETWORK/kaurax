// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Types} from "../libraries/Types.sol";

/// @title IKauraxL2OutputOracle
/// @notice Holds KAURAX L3 state commitments on the underlying L2.
///
/// @dev v0 has NO fault-proof system. Proposals are trusted: only the designated
///      proposer may write, and only the challenger may delete. This is a centralization
///      assumption, documented in docs/decentralization.md, and is the single largest
///      blocker to mainnet.
interface IKauraxL2OutputOracle {
    event OutputProposed(
        bytes32 indexed outputRoot,
        uint256 indexed outputIndex,
        uint256 indexed l3BlockNumber,
        uint256 l2Timestamp
    );
    event OutputsDeleted(uint256 indexed prevNextOutputIndex, uint256 indexed newNextOutputIndex);

    function proposeL2Output(
        bytes32 _outputRoot,
        uint256 _l3BlockNumber,
        bytes32 _l2BlockHash,
        uint256 _l2BlockNumber
    ) external payable;

    function deleteL2Outputs(uint256 _l2OutputIndex) external;

    function getL2Output(uint256 _l2OutputIndex) external view returns (Types.OutputProposal memory);
    function latestOutputIndex() external view returns (uint256);
    function nextOutputIndex() external view returns (uint256);
    function latestBlockNumber() external view returns (uint256);
    function nextBlockNumber() external view returns (uint256);
    function getL2OutputIndexAfter(uint256 _l3BlockNumber) external view returns (uint256);
    function finalizationPeriodSeconds() external view returns (uint256);
}
