// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IKauraxPortal} from "../interfaces/IKauraxPortal.sol";
import {IForcedInclusion} from "../interfaces/IForcedInclusion.sol";
import {IKauraxL2OutputOracle} from "../interfaces/IKauraxL2OutputOracle.sol";
import {Types} from "../libraries/Types.sol";
import {Hashing} from "../libraries/Hashing.sol";
import {MerkleTree} from "../libraries/MerkleTree.sol";
import {AddressAliasHelper} from "../libraries/AddressAliasHelper.sol";

/// @title KauraxPortal
/// @notice Canonical bridge between the underlying L2 and KAURAX L3. Deployed on the L2.
///
/// @dev Security posture, stated plainly:
///        - Withdrawals are cryptographically proven against a proposed output root, but
///          the output root itself is NOT fault proven (see KauraxL2OutputOracle). An
///          incorrect proposal that survives the challenge window can drain this contract.
///          That is the central trust assumption of v0.
///        - The deposit path doubles as the forced-inclusion escape hatch. It is
///          implemented; it has not been adversarially tested.
///      See docs/threat-model.md.
contract KauraxPortal is IKauraxPortal, IForcedInclusion {
    /// @notice Version tag included in the TransactionDeposited event.
    uint256 internal constant DEPOSIT_VERSION = 0;

    /// @notice Gas floor for a deposit, covering the L3-side derivation overhead.
    uint64 internal constant MIN_DEPOSIT_GAS_LIMIT = 21000;

    /// @notice Upper bound on deposit calldata, to keep the derived L3 system transaction
    ///         within the L3 block gas limit.
    uint256 internal constant MAX_DEPOSIT_DATA_LENGTH = 120_000;

    /// @notice Sentinel used while no withdrawal is executing.
    address internal constant NOT_ENTERED = address(1);

    IKauraxL2OutputOracle public immutable OUTPUT_ORACLE;

    /// @notice May pause deposits and withdrawal finalization.
    address public guardian;

    bool public paused;

    uint256 public depositCount;

    /// @notice The KAURAX-side sender of the withdrawal currently being finalized.
    ///         Readable by the target contract, in the style of a cross-domain messenger.
    address public l3Sender = NOT_ENTERED;

    struct ProvenWithdrawal {
        bytes32 outputRoot;
        uint128 timestamp;
        uint128 l2OutputIndex;
    }

    /// @notice withdrawalHash => the proof that was accepted.
    mapping(bytes32 => ProvenWithdrawal) public provenWithdrawals;

    /// @notice withdrawalHash => finalized.
    mapping(bytes32 => bool) public finalizedWithdrawals;

    // ------------------------------------------------------------------ //
    //                        Forced inclusion                            //
    // ------------------------------------------------------------------ //
    //
    // A deposit is already uncensorable in the sense that it originates from an L2 event.
    // What was missing is a *deadline*: nothing obliged the sequencer to act on one, so a
    // user holding KAX on KAURAX with a censoring sequencer had no way out.
    //
    // A forced transaction is a deposit with a clock. If the sequencer does not acknowledge
    // it within FORCED_INCLUSION_WINDOW L2 blocks, `hasOverdueForcedTransactions()` becomes
    // true and `KauraxL2OutputOracle` refuses further output proposals. Censoring one user
    // therefore halts settlement for everyone, including the sequencer.
    //
    // Honest limit: acknowledgement is the sequencer's own assertion. A sequencer that
    // acknowledges without including is lying, and that lie is detectable by replaying
    // from data availability but not preventable on chain. That is the same class of
    // problem as an incorrect output root, and it is what fault proofs would close.

    struct ForcedTransaction {
        address from;
        address to;
        uint256 value;
        uint64 gasLimit;
        uint64 submittedAtL2Block;
        uint64 deadlineL2Block;
        bool acknowledged;
    }

    /// @notice L2 blocks the sequencer has to include a forced transaction.
    uint256 public forcedInclusionWindow;

    /// @notice The address permitted to acknowledge inclusion. The sequencer.
    address public sequencer;

    ForcedTransaction[] internal _forced;

    /// @notice Index of the oldest forced transaction not yet acknowledged.
    uint256 public forcedCursor;

    /// @notice Emitted when a user forces a transaction the sequencer must include.
    event TransactionForced(
        uint256 indexed forcedId,
        address indexed from,
        address indexed to,
        uint256 value,
        uint64 gasLimit,
        bytes data,
        uint256 deadlineL2Block
    );
    event ForcedTransactionAcknowledged(uint256 indexed forcedId, uint256 l3BlockNumber);
    event ForcedInclusionWindowUpdated(uint256 previous, uint256 current);
    event SequencerUpdated(address indexed previous, address indexed current);

    event GuardianUpdated(address indexed previous, address indexed current);

    error IsPaused();
    error NotGuardian();
    error ZeroAddress();
    error CreationWithNonZeroTarget();
    error GasLimitTooLow();
    error DataTooLarge();
    error InvalidOutputRootProof();
    error InvalidWithdrawalInclusionProof();
    error WithdrawalNotProven();
    error WithdrawalAlreadyFinalized();
    error ChallengePeriodNotElapsed();
    error ProposalReplaced();
    error OutputNotFinalized();
    error ReentrantFinalize();
    error TargetIsPortal();
    error AlreadyProvenAtSameRoot();
    error NotSequencer();
    error UnknownForcedTransaction();
    error ForcedAlreadyAcknowledged();
    error InvalidWindow();

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    constructor(
        address _outputOracle,
        address _guardian,
        address _sequencer,
        uint256 _forcedInclusionWindow
    ) {
        if (_outputOracle == address(0) || _guardian == address(0) || _sequencer == address(0)) {
            revert ZeroAddress();
        }
        // A window of zero would make every forced transaction instantly overdue and halt
        // the chain; an unbounded one would make the guarantee meaningless.
        if (_forcedInclusionWindow == 0 || _forcedInclusionWindow > 100_000) revert InvalidWindow();

        OUTPUT_ORACLE = IKauraxL2OutputOracle(_outputOracle);
        guardian = _guardian;
        sequencer = _sequencer;
        forcedInclusionWindow = _forcedInclusionWindow;
    }

    // ------------------------------------------------------------------ //
    //                        L2 -> L3   (deposits)                       //
    // ------------------------------------------------------------------ //

    /// @notice Plain transfers are treated as a deposit to the sender on KAURAX.
    receive() external payable {
        depositTransaction(msg.sender, msg.value, MIN_DEPOSIT_GAS_LIMIT, false, bytes(""));
    }

    /// @inheritdoc IKauraxPortal
    /// @dev Emits the event that kaurax-node's derivation pipeline turns into an L3
    ///      system transaction. Native value sent here is escrowed by this contract and
    ///      minted to `_to` on KAURAX.
    function depositTransaction(
        address _to,
        uint256 _value,
        uint64 _gasLimit,
        bool _isCreation,
        bytes memory _data
    ) public payable whenNotPaused {
        if (_isCreation && _to != address(0)) revert CreationWithNonZeroTarget();
        if (_gasLimit < MIN_DEPOSIT_GAS_LIMIT) revert GasLimitTooLow();
        if (_data.length > MAX_DEPOSIT_DATA_LENGTH) revert DataTooLarge();

        address from = AddressAliasHelper.applyAliasIfContract(msg.sender);

        // msg.value is what is actually escrowed and therefore what may be minted on L3.
        // `_value` is the value the L3 transaction carries; they are separate so that a
        // deposit can call an L3 contract with value drawn from an earlier deposit.
        bytes memory opaqueData = abi.encodePacked(msg.value, _value, _gasLimit, _isCreation, _data);

        emit TransactionDeposited(from, _to, DEPOSIT_VERSION, opaqueData);
        unchecked {
            depositCount++;
        }
    }

    // ------------------------------------------------------------------ //
    //                        Forced transactions                         //
    // ------------------------------------------------------------------ //

    /// @notice Force KAURAX to include a transaction, on a deadline.
    ///
    /// @dev This is the exit hatch. To withdraw KAX that is already on KAURAX while the
    ///      sequencer is censoring you, force a transaction to the L3 message passer:
    ///
    ///          forceTransaction(
    ///              L3ToL2MessagePasser,
    ///              amountYouHoldOnL3,
    ///              gasLimit,
    ///              abi.encodeCall(initiateWithdrawal, (you, gasLimit, ""))
    ///          )
    ///
    ///      The derived L3 transaction executes as *you* (an EOA sender is not aliased),
    ///      so it spends your existing L3 balance. No KAX needs to be sent here.
    function forceTransaction(address _to, uint256 _value, uint64 _gasLimit, bytes memory _data)
        external
        payable
        whenNotPaused
        returns (uint256 forcedId)
    {
        if (_gasLimit < MIN_DEPOSIT_GAS_LIMIT) revert GasLimitTooLow();
        if (_data.length > MAX_DEPOSIT_DATA_LENGTH) revert DataTooLarge();

        address from = AddressAliasHelper.applyAliasIfContract(msg.sender);
        uint64 deadline = uint64(block.number + forcedInclusionWindow);

        forcedId = _forced.length;
        _forced.push(
            ForcedTransaction({
                from: from,
                to: _to,
                value: _value,
                gasLimit: _gasLimit,
                submittedAtL2Block: uint64(block.number),
                deadlineL2Block: deadline,
                acknowledged: false
            })
        );

        // Also emitted as an ordinary deposit, so the existing derivation pipeline picks it
        // up with no special casing. The forced event carries the deadline.
        bytes memory opaqueData = abi.encodePacked(msg.value, _value, _gasLimit, false, _data);
        emit TransactionDeposited(from, _to, DEPOSIT_VERSION, opaqueData);
        unchecked {
            depositCount++;
        }

        emit TransactionForced(forcedId, from, _to, _value, _gasLimit, _data, deadline);
    }

    /// @notice Sequencer confirms it included forced transactions up to and including `_upToId`.
    /// @dev Acknowledging in ranges keeps the cost constant regardless of backlog.
    function acknowledgeForcedTransactions(uint256 _upToId, uint256 _l3BlockNumber) external {
        if (msg.sender != sequencer) revert NotSequencer();
        if (_upToId >= _forced.length) revert UnknownForcedTransaction();
        if (_upToId < forcedCursor) revert ForcedAlreadyAcknowledged();

        for (uint256 i = forcedCursor; i <= _upToId; i++) {
            _forced[i].acknowledged = true;
            emit ForcedTransactionAcknowledged(i, _l3BlockNumber);
        }
        forcedCursor = _upToId + 1;
    }

    /// @inheritdoc IForcedInclusion
    function hasOverdueForcedTransactions() public view returns (bool) {
        if (forcedCursor >= _forced.length) return false;
        return block.number > _forced[forcedCursor].deadlineL2Block;
    }

    /// @inheritdoc IForcedInclusion
    function oldestForcedDeadline() external view returns (uint256) {
        if (forcedCursor >= _forced.length) return 0;
        return _forced[forcedCursor].deadlineL2Block;
    }

    /// @inheritdoc IForcedInclusion
    function pendingForcedCount() external view returns (uint256) {
        return _forced.length - forcedCursor;
    }

    function forcedTransactionCount() external view returns (uint256) {
        return _forced.length;
    }

    function getForcedTransaction(uint256 _forcedId) external view returns (ForcedTransaction memory) {
        if (_forcedId >= _forced.length) revert UnknownForcedTransaction();
        return _forced[_forcedId];
    }

    function setSequencer(address _sequencer) external {
        if (msg.sender != guardian) revert NotGuardian();
        if (_sequencer == address(0)) revert ZeroAddress();
        emit SequencerUpdated(sequencer, _sequencer);
        sequencer = _sequencer;
    }

    function setForcedInclusionWindow(uint256 _window) external {
        if (msg.sender != guardian) revert NotGuardian();
        if (_window == 0 || _window > 100_000) revert InvalidWindow();
        emit ForcedInclusionWindowUpdated(forcedInclusionWindow, _window);
        forcedInclusionWindow = _window;
    }

    // ------------------------------------------------------------------ //
    //                       L3 -> L2   (withdrawals)                     //
    // ------------------------------------------------------------------ //

    /// @inheritdoc IKauraxPortal
    /// @param _tx                The withdrawal, as originated on KAURAX.
    /// @param _l2OutputIndex     Index of the output proposal to prove against.
    /// @param _outputRootProof   Preimage of that proposal's output root.
    /// @param _withdrawalIndex   Leaf index of the withdrawal in the L3 withdrawal tree.
    /// @param _withdrawalProof   Sibling hashes, leaf-to-root, length MerkleTree.TREE_DEPTH.
    function proveWithdrawalTransaction(
        Types.WithdrawalTransaction memory _tx,
        uint256 _l2OutputIndex,
        Types.OutputRootProof memory _outputRootProof,
        uint256 _withdrawalIndex,
        bytes32[] memory _withdrawalProof
    ) external whenNotPaused {
        // A withdrawal targeting the portal itself could re-enter finalization accounting.
        if (_tx.target == address(this)) revert TargetIsPortal();

        Types.OutputProposal memory proposal = OUTPUT_ORACLE.getL2Output(_l2OutputIndex);

        // 1. The supplied preimage must actually be the preimage of the proposed root.
        if (Hashing.hashOutputRoot(_outputRootProof) != proposal.outputRoot) revert InvalidOutputRootProof();

        bytes32 withdrawalHash = Hashing.hashWithdrawal(_tx);

        // 2. The withdrawal must be included in the withdrawal tree that root commits to.
        bool included = MerkleTree.verify(
            _outputRootProof.withdrawalTreeRoot, withdrawalHash, _withdrawalIndex, _withdrawalProof
        );
        if (!included) revert InvalidWithdrawalInclusionProof();

        // Re-proving is permitted only against a *different* root — the case where the
        // challenger deleted the original proposal and the proposer republished. Allowing
        // a re-prove against the same root would let anyone reset the challenge clock.
        ProvenWithdrawal memory prior = provenWithdrawals[withdrawalHash];
        if (prior.timestamp != 0 && prior.outputRoot == proposal.outputRoot) {
            revert AlreadyProvenAtSameRoot();
        }
        if (finalizedWithdrawals[withdrawalHash]) revert WithdrawalAlreadyFinalized();

        provenWithdrawals[withdrawalHash] = ProvenWithdrawal({
            outputRoot: proposal.outputRoot,
            timestamp: uint128(block.timestamp),
            l2OutputIndex: uint128(_l2OutputIndex)
        });

        emit WithdrawalProven(withdrawalHash, _tx.sender, _tx.target);
    }

    /// @inheritdoc IKauraxPortal
    /// @dev slither reports reentrancy-eth here because `l3Sender` is written after the
    ///      external call. Re-entry is refused on the first line of the function, and the
    ///      withdrawal is marked finalized before the call, so the only post-call write is
    ///      clearing the sentinel. Suppressed for that reason, not to quiet the gate.
    // slither-disable-next-line reentrancy-eth,arbitrary-send-eth
    function finalizeWithdrawalTransaction(Types.WithdrawalTransaction memory _tx) external whenNotPaused {
        if (l3Sender != NOT_ENTERED) revert ReentrantFinalize();
        if (_tx.target == address(this)) revert TargetIsPortal();

        bytes32 withdrawalHash = Hashing.hashWithdrawal(_tx);
        ProvenWithdrawal memory proven = provenWithdrawals[withdrawalHash];

        if (proven.timestamp == 0) revert WithdrawalNotProven();
        if (finalizedWithdrawals[withdrawalHash]) revert WithdrawalAlreadyFinalized();

        uint256 window = OUTPUT_ORACLE.finalizationPeriodSeconds();
        if (block.timestamp < uint256(proven.timestamp) + window) revert ChallengePeriodNotElapsed();

        // The proposal proven against must still be the live one. If it was deleted or
        // replaced, the withdrawal must be re-proven.
        Types.OutputProposal memory current = OUTPUT_ORACLE.getL2Output(uint256(proven.l2OutputIndex));
        if (current.outputRoot != proven.outputRoot) revert ProposalReplaced();

        // And the proposal must actually be settled, which is not the same as the
        // withdrawal's own challenge period having elapsed. An output with a live dispute
        // is not settled: paying out against it would let a withdrawal complete while the
        // commitment it rests on is still being contested, and a challenger who then wins
        // would find the funds already gone.
        if (!OUTPUT_ORACLE.isOutputFinalized(uint256(proven.l2OutputIndex))) {
            revert OutputNotFinalized();
        }

        // Effects before interaction.
        finalizedWithdrawals[withdrawalHash] = true;
        l3Sender = _tx.sender;

        // slither-disable-next-line arbitrary-send-eth
        // The target is not arbitrary: it comes from a withdrawal proven by Merkle inclusion
        // against a finalized output root. Sending to a caller-chosen address is what a
        // bridge does; the proof is what makes it safe.
        (bool success,) = _tx.target.call{value: _tx.value, gas: _tx.gasLimit}(_tx.data);

        l3Sender = NOT_ENTERED;

        // A failed call still consumes the withdrawal. Allowing a retry would let a target
        // that reverts on demand be replayed until conditions favour the caller, and would
        // make the finalized set non-monotonic. The value stays escrowed in this contract.
        //
        // The outcome is reported in the event rather than by reverting, and deliberately
        // does not depend on whether the caller is an EOA or a contract: identical inputs
        // must produce identical state. Bridge withdrawals should therefore target the
        // bridge, not an arbitrary user contract.
        emit WithdrawalFinalized(withdrawalHash, success);
    }

    // ------------------------------------------------------------------ //
    //                              Guardian                              //
    // ------------------------------------------------------------------ //

    function pause() external {
        if (msg.sender != guardian) revert NotGuardian();
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external {
        if (msg.sender != guardian) revert NotGuardian();
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setGuardian(address _guardian) external {
        if (msg.sender != guardian) revert NotGuardian();
        if (_guardian == address(0)) revert ZeroAddress();
        emit GuardianUpdated(guardian, _guardian);
        guardian = _guardian;
    }

    /// @notice Native asset escrowed on the L2 backing KAX in circulation on KAURAX.
    function balance() external view returns (uint256) {
        return address(this).balance;
    }
}
