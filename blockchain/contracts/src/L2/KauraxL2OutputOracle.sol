// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IKauraxL2OutputOracle} from "../interfaces/IKauraxL2OutputOracle.sol";
import {IForcedInclusion} from "../interfaces/IForcedInclusion.sol";
import {Types} from "../libraries/Types.sol";

/// @title KauraxL2OutputOracle
/// @notice Stores KAURAX L3 output roots on the underlying L2.
///
/// @dev NOT FAULT PROVEN. A proposal is accepted because it came from the proposer key,
///      not because it was verified. The `challenger` may delete proposals within the
///      finalization period, which is a trusted-operator backstop, not a proof system.
///      Replacing this contract with a dispute game is tracked in
///      docs/decentralization.md and MAINNET_READINESS.md.
contract KauraxL2OutputOracle is IKauraxL2OutputOracle {
    /// @notice Interval, in KAURAX L3 blocks, between output proposals.
    uint256 public immutable SUBMISSION_INTERVAL;

    /// @notice KAURAX L3 block time, seconds. Used to derive expected timestamps.
    uint256 public immutable L3_BLOCK_TIME;

    /// @notice First KAURAX block this oracle commits to.
    uint256 public immutable STARTING_BLOCK_NUMBER;

    /// @notice Timestamp of the starting block.
    uint256 public immutable STARTING_TIMESTAMP;

    /// @notice Withdrawal challenge window, seconds.
    uint256 public immutable FINALIZATION_PERIOD_SECONDS;

    address public proposer;
    address public challenger;

    /// @notice The portal, consulted for overdue forced transactions.
    ///
    /// @dev Set after deployment because the portal needs this oracle's address at
    ///      construction. Until it is set, forced-inclusion enforcement is inactive — which
    ///      `forcedInclusionEnforced()` reports honestly rather than implying a guarantee
    ///      that is not wired up.
    IForcedInclusion public forcedInclusion;

    Types.OutputProposal[] internal l2Outputs;

    event ProposerUpdated(address indexed previous, address indexed current);
    event ChallengerUpdated(address indexed previous, address indexed current);
    event ForcedInclusionUpdated(address indexed previous, address indexed current);

    error NotProposer();
    error NotChallenger();
    error ZeroAddress();
    error InvalidOutputRoot();
    error UnexpectedBlockNumber(uint256 expected, uint256 got);
    error BlockNumberInFuture();
    error L2BlockHashMismatch();
    error NoOutputs();
    error OutputIndexOutOfBounds();
    error CannotDeleteFinalized();
    error InvalidStartingConfig();
    error ForcedTransactionOverdue(uint256 deadlineL2Block, uint256 currentL2Block);

    modifier onlyProposer() {
        if (msg.sender != proposer) revert NotProposer();
        _;
    }

    constructor(
        uint256 _submissionInterval,
        uint256 _l3BlockTime,
        uint256 _startingBlockNumber,
        uint256 _startingTimestamp,
        uint256 _finalizationPeriodSeconds,
        address _proposer,
        address _challenger
    ) {
        if (_submissionInterval == 0 || _l3BlockTime == 0) {
            revert InvalidStartingConfig();
        }
        if (_startingTimestamp > block.timestamp) revert InvalidStartingConfig();
        if (_proposer == address(0) || _challenger == address(0)) revert ZeroAddress();

        SUBMISSION_INTERVAL = _submissionInterval;
        L3_BLOCK_TIME = _l3BlockTime;
        STARTING_BLOCK_NUMBER = _startingBlockNumber;
        STARTING_TIMESTAMP = _startingTimestamp;
        FINALIZATION_PERIOD_SECONDS = _finalizationPeriodSeconds;
        proposer = _proposer;
        challenger = _challenger;
    }

    /// @inheritdoc IKauraxL2OutputOracle
    /// @param _outputRoot   Commitment to KAURAX state. See Hashing.hashOutputRoot.
    /// @param _l3BlockNumber KAURAX block the root commits to.
    /// @param _l2BlockHash  Hash of a recent L2 block, to pin the proposal to an L2 view
    ///                      and make it fail on an L2 reorg rather than silently land.
    /// @param _l2BlockNumber The L2 block number `_l2BlockHash` refers to.
    function proposeL2Output(
        bytes32 _outputRoot,
        uint256 _l3BlockNumber,
        bytes32 _l2BlockHash,
        uint256 _l2BlockNumber
    ) external payable onlyProposer {
        if (_outputRoot == bytes32(0)) revert InvalidOutputRoot();

        // Censoring a user costs the sequencer its ability to settle. If a forced
        // transaction has gone unacknowledged past its deadline, no further state
        // commitments are accepted — which stalls every withdrawal, including any the
        // operator cares about. That is the incentive, and it needs no proof system.
        IForcedInclusion fi = forcedInclusion;
        if (address(fi) != address(0) && fi.hasOverdueForcedTransactions()) {
            revert ForcedTransactionOverdue(fi.oldestForcedDeadline(), block.number);
        }

        uint256 expected = nextBlockNumber();
        if (_l3BlockNumber != expected) revert UnexpectedBlockNumber(expected, _l3BlockNumber);

        // Reject a proposal for L3 blocks that could not exist yet given the configured
        // block time. Cheap sanity bound, not a proof.
        if (computeL3Timestamp(_l3BlockNumber) >= block.timestamp) revert BlockNumberInFuture();

        // If the proposer pinned an L2 block, require it to still be canonical.
        if (_l2BlockHash != bytes32(0) && _l2BlockNumber != 0) {
            if (blockhash(_l2BlockNumber) != _l2BlockHash) revert L2BlockHashMismatch();
        }

        emit OutputProposed(_outputRoot, nextOutputIndex(), _l3BlockNumber, block.timestamp);

        l2Outputs.push(
            Types.OutputProposal({
                outputRoot: _outputRoot,
                timestamp: uint128(block.timestamp),
                l3BlockNumber: uint128(_l3BlockNumber)
            })
        );
    }

    /// @notice Challenger backstop: remove proposals from `_l2OutputIndex` onward.
    /// @dev Only unfinalized proposals may be deleted; a finalized withdrawal must not be
    ///      retroactively invalidated.
    function deleteL2Outputs(uint256 _l2OutputIndex) external {
        if (msg.sender != challenger) revert NotChallenger();
        if (_l2OutputIndex >= l2Outputs.length) revert OutputIndexOutOfBounds();
        if (l2Outputs[_l2OutputIndex].timestamp + FINALIZATION_PERIOD_SECONDS < block.timestamp) {
            revert CannotDeleteFinalized();
        }

        uint256 prevNext = l2Outputs.length;
        assembly {
            sstore(l2Outputs.slot, _l2OutputIndex)
        }
        emit OutputsDeleted(prevNext, _l2OutputIndex);
    }

    function getL2Output(uint256 _l2OutputIndex) external view returns (Types.OutputProposal memory) {
        if (_l2OutputIndex >= l2Outputs.length) revert OutputIndexOutOfBounds();
        return l2Outputs[_l2OutputIndex];
    }

    /// @notice Index of the first proposal whose L3 block number is >= `_l3BlockNumber`.
    function getL2OutputIndexAfter(uint256 _l3BlockNumber) public view returns (uint256) {
        if (l2Outputs.length == 0) revert NoOutputs();
        if (latestBlockNumber() < _l3BlockNumber) revert OutputIndexOutOfBounds();

        uint256 lo = 0;
        uint256 hi = l2Outputs.length;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (l2Outputs[mid].l3BlockNumber < _l3BlockNumber) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    function latestOutputIndex() external view returns (uint256) {
        if (l2Outputs.length == 0) revert NoOutputs();
        return l2Outputs.length - 1;
    }

    function nextOutputIndex() public view returns (uint256) {
        return l2Outputs.length;
    }

    function latestBlockNumber() public view returns (uint256) {
        return l2Outputs.length == 0
            ? STARTING_BLOCK_NUMBER
            : uint256(l2Outputs[l2Outputs.length - 1].l3BlockNumber);
    }

    function nextBlockNumber() public view returns (uint256) {
        return l2Outputs.length == 0 ? STARTING_BLOCK_NUMBER : latestBlockNumber() + SUBMISSION_INTERVAL;
    }

    function computeL3Timestamp(uint256 _l3BlockNumber) public view returns (uint256) {
        return STARTING_TIMESTAMP + ((_l3BlockNumber - STARTING_BLOCK_NUMBER) * L3_BLOCK_TIME);
    }

    function finalizationPeriodSeconds() external view returns (uint256) {
        return FINALIZATION_PERIOD_SECONDS;
    }

    function outputCount() external view returns (uint256) {
        return l2Outputs.length;
    }

    /// @notice Wire the portal in. Callable once, by the challenger, at deployment time.
    function setForcedInclusion(address _portal) external {
        if (msg.sender != challenger) revert NotChallenger();
        if (_portal == address(0)) revert ZeroAddress();
        emit ForcedInclusionUpdated(address(forcedInclusion), _portal);
        forcedInclusion = IForcedInclusion(_portal);
    }

    /// @notice Whether forced-inclusion enforcement is actually active on this deployment.
    function forcedInclusionEnforced() external view returns (bool) {
        return address(forcedInclusion) != address(0);
    }

    function setProposer(address _proposer) external {
        if (msg.sender != challenger) revert NotChallenger();
        if (_proposer == address(0)) revert ZeroAddress();
        emit ProposerUpdated(proposer, _proposer);
        proposer = _proposer;
    }

    function setChallenger(address _challenger) external {
        if (msg.sender != challenger) revert NotChallenger();
        if (_challenger == address(0)) revert ZeroAddress();
        emit ChallengerUpdated(challenger, _challenger);
        challenger = _challenger;
    }
}
