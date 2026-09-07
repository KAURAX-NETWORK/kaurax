// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IKauraxL2OutputOracle} from "../interfaces/IKauraxL2OutputOracle.sol";
import {IForcedInclusion} from "../interfaces/IForcedInclusion.sol";
import {IKauraxDisputeGame} from "../interfaces/IKauraxDisputeGame.sol";
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

    /// @notice What a proposer must escrow with every output root.
    ///
    /// @dev Escrowed at proposal time rather than when a challenge arrives. The difference
    ///      matters: a bond posted only on challenge means a root carries no stake until
    ///      somebody objects, so a proposer that never intends to defend walks away having
    ///      risked nothing it had already committed.
    uint256 public immutable PROPOSER_BOND;

    /// @notice The dispute game, consulted before an output is treated as final.
    ///
    /// @dev Set after deployment because the game needs this oracle's address at
    ///      construction. While unset, finalization is the timer alone — which
    ///      `disputeGameEnforced()` reports rather than implying a guarantee that is not
    ///      wired up.
    IKauraxDisputeGame public disputeGame;

    Types.OutputProposal[] internal l2Outputs;

    /// @notice Who proposed each output, so a dispute cannot be opened against the wrong
    ///         party and a bond can be returned to the right one.
    mapping(uint256 => address) public proposalProposer;

    /// @notice Escrow held against each output index.
    mapping(uint256 => uint256) public proposalBond;

    /// @notice Bonds owed, withdrawn by their owner rather than pushed.
    ///
    /// @dev Pull, not push: a deletion refunds every proposal above the disputed one, and
    ///      pushing to each in a loop would let a single proposer whose fallback reverts
    ///      block the deletion entirely.
    mapping(address => uint256) public withdrawableBond;

    event ProposerUpdated(address indexed previous, address indexed current);
    event ChallengerUpdated(address indexed previous, address indexed current);
    event ForcedInclusionUpdated(address indexed previous, address indexed current);
    event DisputeGameUpdated(address indexed previous, address indexed current);
    event ProposalBonded(uint256 indexed outputIndex, address indexed proposer, uint256 amount);
    event ProposalBondForfeited(uint256 indexed outputIndex, address indexed to, uint256 amount);
    event ProposalBondRefunded(uint256 indexed outputIndex, address indexed proposer, uint256 amount);
    event BondWithdrawn(address indexed to, uint256 amount);

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
    error WrongProposerBond(uint256 expected, uint256 got);
    error OutputNotFinalized();
    error NothingToWithdraw();
    error BondTransferFailed();
    error OutputStillLive();

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
        address _challenger,
        uint256 _proposerBond
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
        PROPOSER_BOND = _proposerBond;
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

        // The stake goes up with the claim, not with the objection to it.
        if (msg.value != PROPOSER_BOND) revert WrongProposerBond(PROPOSER_BOND, msg.value);

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

        uint256 index = nextOutputIndex();
        emit OutputProposed(_outputRoot, index, _l3BlockNumber, block.timestamp);

        proposalProposer[index] = msg.sender;
        if (msg.value > 0) {
            proposalBond[index] = msg.value;
            emit ProposalBonded(index, msg.sender, msg.value);
        }

        l2Outputs.push(
            Types.OutputProposal({
                outputRoot: _outputRoot,
                timestamp: uint128(block.timestamp),
                l3BlockNumber: uint128(_l3BlockNumber)
            })
        );
    }

    /// @notice Is this output settled — past its window and not under dispute?
    ///
    /// @dev The timer alone is not enough. An output whose challenge is still being played
    ///      must not finalize underneath the game: a challenger could win and find the
    ///      commitment already spent against. So a live game holds finalization open, and
    ///      that is what makes the dispute game worth playing at all.
    function isOutputFinalized(uint256 _l2OutputIndex) public view returns (bool) {
        if (_l2OutputIndex >= l2Outputs.length) return false;
        if (l2Outputs[_l2OutputIndex].timestamp + FINALIZATION_PERIOD_SECONDS >= block.timestamp) {
            return false;
        }
        IKauraxDisputeGame game = disputeGame;
        if (address(game) != address(0) && game.hasLiveGame(_l2OutputIndex)) return false;
        return true;
    }

    /// @notice Whether a dispute game is wired in. False means finalization is the timer
    ///         alone, which is stated rather than implied.
    function disputeGameEnforced() external view returns (bool) {
        return address(disputeGame) != address(0);
    }

    /// @notice Remove proposals from `_l2OutputIndex` onward, and settle their bonds.
    ///
    /// @dev Callable only by `challenger`, which in a configured deployment is the dispute
    ///      game — so deleting a state commitment is the outcome of a played game rather
    ///      than the act of a single key.
    ///
    ///      Bond accounting, and why it is split:
    ///        - the disputed output's bond is credited to the caller, which is the game;
    ///          it pays the challenger who was right.
    ///        - every later output is deleted as a consequence, not as a judgement. Those
    ///          proposals were never adjudicated, so their bonds are credited back to their
    ///          proposers.
    ///
    ///      Both are credited, not transferred. The loop is bounded by the number of
    ///      unfinalized outputs, which is the finalization period divided by the submission
    ///      interval — small by construction.
    function deleteL2Outputs(uint256 _l2OutputIndex) external {
        if (msg.sender != challenger) revert NotChallenger();
        if (_l2OutputIndex >= l2Outputs.length) revert OutputIndexOutOfBounds();
        if (isOutputFinalized(_l2OutputIndex)) revert CannotDeleteFinalized();

        uint256 prevNext = l2Outputs.length;

        for (uint256 i = _l2OutputIndex; i < prevNext; i++) {
            uint256 bond = proposalBond[i];
            if (bond > 0) {
                proposalBond[i] = 0;
                if (i == _l2OutputIndex) {
                    withdrawableBond[msg.sender] += bond;
                    emit ProposalBondForfeited(i, msg.sender, bond);
                } else {
                    address who = proposalProposer[i];
                    withdrawableBond[who] += bond;
                    emit ProposalBondRefunded(i, who, bond);
                }
            }
            // Cleared because deletion frees the index for reuse, and a stale record would
            // then describe a different proposal.
            delete proposalProposer[i];
        }

        assembly {
            sstore(l2Outputs.slot, _l2OutputIndex)
        }
        emit OutputsDeleted(prevNext, _l2OutputIndex);
    }

    /// @notice Reclaim the escrow behind an output that survived its challenge window.
    function claimProposalBond(uint256 _l2OutputIndex) external {
        if (!isOutputFinalized(_l2OutputIndex)) revert OutputNotFinalized();
        if (msg.sender != proposalProposer[_l2OutputIndex]) revert NotProposer();

        uint256 bond = proposalBond[_l2OutputIndex];
        if (bond == 0) revert NothingToWithdraw();
        proposalBond[_l2OutputIndex] = 0;
        withdrawableBond[msg.sender] += bond;
        emit ProposalBondRefunded(_l2OutputIndex, msg.sender, bond);
    }

    /// @notice Withdraw everything credited to the caller.
    /// @dev Balance zeroed before the transfer; a failed transfer reverts rather than being
    ///      swallowed, so a bond is never silently kept.
    function withdrawBond() external {
        uint256 amount = withdrawableBond[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        withdrawableBond[msg.sender] = 0;

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert BondTransferFailed();
        emit BondWithdrawn(msg.sender, amount);
    }

    /// @notice Wire in the dispute game. Challenger-only, matching setForcedInclusion.
    function setDisputeGame(address _game) external {
        if (msg.sender != challenger) revert NotChallenger();
        emit DisputeGameUpdated(address(disputeGame), _game);
        disputeGame = IKauraxDisputeGame(_game);
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
