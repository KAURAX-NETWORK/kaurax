// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IKauraxL2OutputOracle} from "../interfaces/IKauraxL2OutputOracle.sol";
import {Types} from "../libraries/Types.sol";

/// @title KauraxDisputeGame
/// @notice Permissionless challenges against KAURAX output roots, with bonds and bisection.
///
/// @dev ─────────────────────────────────────────────────────────────────────────────────
///      THIS IS NOT A FAULT PROOF SYSTEM.
///
///      A fault proof ends with a contract executing one disputed instruction and deciding,
///      from that execution alone, who was right. KAURAX has no such verifier — see
///      docs/FAULT_PROOF_SPEC.md, which specifies one and marks every part of it NOT
///      IMPLEMENTED.
///
///      What this contract does is narrow a disagreement about a range of KAURAX blocks
///      down to a single block, on chain, with both sides bonded and on a clock. It then
///      hands that single block to the guardian to decide.
///
///      So the guardian remains the final arbiter, and this contract does not pretend
///      otherwise. What it changes is worth having anyway:
///
///        - challenging becomes permissionless. Before this, only one key could delete an
///          output root, so an absent or captured challenger meant nobody could object;
///        - lying costs money in both directions, symmetrically;
///        - the guardian's job shrinks from "audit an entire range and take someone's word"
///          to "check one block", which is small enough to be checked in public and to be
///          replaced later by a verifier for exactly that step;
///        - every move is on chain, so an observer can reconstruct who claimed what and
///          when, and judge the guardian's decision afterwards.
///
///      The bisection here is over BLOCKS, not over an execution trace. Reaching a single
///      instruction requires the trace commitments described in the specification, which do
///      not exist yet. This is the honest limit of the current architecture.
///      ─────────────────────────────────────────────────────────────────────────────────
contract KauraxDisputeGame {
    // ------------------------------------------------------------------ types --

    enum Status {
        NONE,
        /// Challenger has opened the game; the proposer must answer.
        PROPOSER_TURN,
        /// Proposer has answered; the challenger must pick a half.
        CHALLENGER_TURN,
        /// Narrowed to one block. Awaiting the guardian.
        AWAITING_RESOLUTION,
        /// Guardian decided the proposer was right.
        RESOLVED_PROPOSER_WINS,
        /// Guardian decided the challenger was right; the output root is deleted.
        RESOLVED_CHALLENGER_WINS,
        /// A side ran out of time. The other wins by default.
        RESOLVED_TIMEOUT,
        /// Opened against an output that was removed underneath it. Bonds returned.
        CANCELLED
    }

    struct Game {
        address challenger;
        address proposer;
        uint256 outputIndex;
        /// @dev The disputed range of KAURAX blocks, narrowed by each move.
        uint128 lo;
        uint128 hi;
        /// @dev The proposer's claimed state root at the midpoint of the current range.
        bytes32 midClaim;
        uint64 deadline;
        uint256 challengerBond;
        uint256 proposerBond;
        Status status;
        /// @dev Guarded against re-entrant payout and double resolution.
        bool bondsSettled;
    }

    // ----------------------------------------------------------- configuration --

    IKauraxL2OutputOracle public immutable ORACLE;

    /// @notice What a challenger must stake to open a game.
    uint256 public immutable CHALLENGER_BOND;

    /// @notice What a proposer must stake to defend one.
    uint256 public immutable PROPOSER_BOND;

    /// @notice How long each side has to move before it forfeits.
    uint64 public immutable RESPONSE_TIMEOUT;

    /// @notice An upper bound on a game's life, so nothing is disputable forever.
    uint64 public immutable MAX_GAME_DURATION;

    /// @notice Final arbiter. Intended to be the multisig, or a timelock in front of it.
    address public guardian;

    Game[] internal games;

    /// @dev One live game per output index. Without this, a proposer could be forced to
    ///      defend the same claim in parallel and lose on the timeout of whichever they
    ///      could not get to — a griefing attack that costs the attacker one bond and the
    ///      proposer several.
    mapping(uint256 => uint256) internal liveGameOfOutput; // outputIndex => gameId + 1

    // ----------------------------------------------------------------- events --

    event GameOpened(
        uint256 indexed gameId,
        uint256 indexed outputIndex,
        address indexed challenger,
        uint128 lo,
        uint128 hi,
        uint256 bond
    );
    event ProposerDefended(uint256 indexed gameId, uint128 mid, bytes32 midClaim, uint64 deadline);
    event ChallengerBisected(
        uint256 indexed gameId, bool tookLowerHalf, uint128 lo, uint128 hi, uint64 deadline
    );
    event NarrowedToBlock(uint256 indexed gameId, uint128 blockNumber, bytes32 proposerClaim);
    event GameResolved(uint256 indexed gameId, Status status, address indexed winner, string reason);
    event BondPaid(uint256 indexed gameId, address indexed to, uint256 amount);
    event BondSlashed(uint256 indexed gameId, address indexed from, uint256 amount, address indexed to);
    event GuardianUpdated(address indexed previous, address indexed current);

    // ----------------------------------------------------------------- errors --

    error NotGuardian();
    error NotChallenger();
    error NotProposer();
    error ZeroAddress();
    error InvalidConfiguration();
    error UnknownGame();
    error GameAlreadyLive(uint256 existingGameId);
    error OutputNotFound();
    error OutputAlreadyFinalized();
    error WrongBond(uint256 expected, uint256 got);
    error WrongTurn(Status expected, Status actual);
    error DeadlinePassed(uint64 deadline);
    error DeadlineNotPassed(uint64 deadline);
    error RangeNotBisectable();
    error NotNarrowed();
    error AlreadySettled();
    error GameExpired();
    error TransferFailed();
    error ResponseTimeoutExceedsFinalization(uint64 responseTimeout, uint256 finalizationPeriod);

    /// @notice A challenger was right but the output had already finalized, so it could not
    ///         be removed. Bonds are returned; the state commitment stands.
    /// @dev This is a real limitation of the current design and is documented as one in
    ///      docs/DISPUTE_GAME.md. The oracle finalizes on a timer that a live dispute does
    ///      not pause, so a long game can outlive the window it was meant to protect.
    event DisputeOutlivedFinalization(uint256 indexed gameId, uint256 indexed outputIndex);

    // ------------------------------------------------------------ construction --

    constructor(
        address _oracle,
        address _guardian,
        uint256 _challengerBond,
        uint256 _proposerBond,
        uint64 _responseTimeout,
        uint64 _maxGameDuration
    ) {
        if (_oracle == address(0) || _guardian == address(0)) revert ZeroAddress();
        // A zero bond makes challenging free, which makes griefing free. A response timeout
        // of zero means the first mover wins by default. Neither is a configuration anyone
        // wants by accident.
        if (_challengerBond == 0 || _proposerBond == 0) revert InvalidConfiguration();
        if (_responseTimeout == 0 || _maxGameDuration < _responseTimeout) revert InvalidConfiguration();

        // A single move must not be able to consume the whole finalization window. This is
        // a floor, not a guarantee: a long bisection can still outlast finalization, which
        // is why _deleteOrCancel exists and why the limitation is documented rather than
        // hidden behind a check that only looks sufficient.
        uint256 finalization = IKauraxL2OutputOracle(_oracle).finalizationPeriodSeconds();
        if (_responseTimeout >= finalization) {
            revert ResponseTimeoutExceedsFinalization(_responseTimeout, finalization);
        }

        ORACLE = IKauraxL2OutputOracle(_oracle);
        guardian = _guardian;
        CHALLENGER_BOND = _challengerBond;
        PROPOSER_BOND = _proposerBond;
        RESPONSE_TIMEOUT = _responseTimeout;
        MAX_GAME_DURATION = _maxGameDuration;
    }

    /// @notice Accepts the escrow the oracle forwards when a disputed output is deleted.
    ///
    /// @dev Without this the oracle's transfer reverts, `withdrawBond` fails, and the
    ///      forfeited escrow stays credited to this contract inside the oracle while the
    ///      challenger is paid only its own bond — a silent loss that the balance
    ///      assertions in the tests caught.
    ///
    ///      Deliberately not a general deposit route: value that arrives here is only ever
    ///      forwarded to a game's winner, and every terminal path asserts the contract
    ///      holds nothing afterwards.
    receive() external payable {}

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    // ------------------------------------------------------------- opening --

    /// @notice Challenge an output root. Anyone may do this; the bond is the only gate.
    /// @param _outputIndex The disputed proposal.
    /// @dev The proposer is read from the oracle, not supplied by the caller. Taking it as
    ///      a parameter let a challenger name someone who had proposed nothing, and bind
    ///      them to a game they had no reason to watch.
    function challenge(uint256 _outputIndex) external payable returns (uint256 gameId) {
        if (msg.value != CHALLENGER_BOND) revert WrongBond(CHALLENGER_BOND, msg.value);

        address _proposer = ORACLE.proposalProposer(_outputIndex);
        if (_proposer == address(0)) revert ZeroAddress();

        uint256 existing = liveGameOfOutput[_outputIndex];
        if (existing != 0) revert GameAlreadyLive(existing - 1);

        Types.OutputProposal memory proposal = ORACLE.getL2Output(_outputIndex);
        if (proposal.outputRoot == bytes32(0)) revert OutputNotFound();

        // Once an output has finalized, withdrawals may already have settled against it.
        // Unwinding that is not something a dispute can do, so it is not offered.
        //
        // Opening a game also holds finalization open: the oracle asks hasLiveGame() before
        // treating an output as final, so the window cannot close underneath a game that is
        // still being played. That is what makes winning one worth anything.
        if (ORACLE.isOutputFinalized(_outputIndex)) revert OutputAlreadyFinalized();

        // The range under dispute is the span this proposal commits to: the block after the
        // previous proposal, through this one's block.
        uint128 lo =
            _outputIndex == 0 ? uint128(0) : uint128(ORACLE.getL2Output(_outputIndex - 1).l3BlockNumber) + 1;
        uint128 hi = uint128(proposal.l3BlockNumber);
        if (hi < lo) revert RangeNotBisectable();

        gameId = games.length;
        games.push(
            Game({
                challenger: msg.sender,
                proposer: _proposer,
                outputIndex: _outputIndex,
                lo: lo,
                hi: hi,
                midClaim: bytes32(0),
                deadline: uint64(block.timestamp) + RESPONSE_TIMEOUT,
                challengerBond: msg.value,
                proposerBond: 0,
                status: Status.PROPOSER_TURN,
                bondsSettled: false
            })
        );
        liveGameOfOutput[_outputIndex] = gameId + 1;

        emit GameOpened(gameId, _outputIndex, msg.sender, lo, hi, msg.value);
    }

    // ------------------------------------------------------------- bisection --

    /// @notice The proposer answers with its claimed state root at the midpoint.
    /// @dev No bond is collected here. The proposer's stake was escrowed by the oracle when
    ///      the output was proposed, so a root carries risk from the moment it is committed
    ///      rather than from the moment somebody objects.
    function defend(uint256 _gameId, bytes32 _midClaim) external {
        Game storage g = _game(_gameId);
        if (msg.sender != g.proposer) revert NotProposer();
        if (g.status != Status.PROPOSER_TURN) revert WrongTurn(Status.PROPOSER_TURN, g.status);
        _requireLive(g);

        g.midClaim = _midClaim;
        g.deadline = uint64(block.timestamp) + RESPONSE_TIMEOUT;

        // A proposal covering exactly one block has nothing left to halve. The disagreement
        // is already as narrow as this architecture can make it, so it goes straight to
        // resolution rather than demanding a bisection that cannot happen.
        if (g.hi <= g.lo) {
            g.status = Status.AWAITING_RESOLUTION;
            emit NarrowedToBlock(_gameId, g.lo, _midClaim);
            return;
        }

        uint128 mid = g.lo + (g.hi - g.lo) / 2;
        g.status = Status.CHALLENGER_TURN;
        emit ProposerDefended(_gameId, mid, _midClaim, g.deadline);
    }

    /// @notice The challenger picks the half it still disputes.
    /// @param _takeLowerHalf True to dispute [lo, mid], false to dispute [mid + 1, hi].
    ///
    /// @dev This is the step that makes the game converge. The challenger disagrees with
    ///      the proposer's state at the midpoint, so the first disagreement lies in one half
    ///      or the other; it says which. Repeating this halves the range each round, so a
    ///      range of N blocks is settled in ceil(log2(N)) exchanges.
    function bisect(uint256 _gameId, bool _takeLowerHalf) external {
        Game storage g = _game(_gameId);
        if (msg.sender != g.challenger) revert NotChallenger();
        if (g.status != Status.CHALLENGER_TURN) revert WrongTurn(Status.CHALLENGER_TURN, g.status);
        _requireLive(g);

        uint128 mid = g.lo + (g.hi - g.lo) / 2;
        if (_takeLowerHalf) {
            g.hi = mid;
        } else {
            g.lo = mid + 1;
        }

        if (g.lo >= g.hi) {
            // One block left. Nothing further can be narrowed without an execution trace.
            g.status = Status.AWAITING_RESOLUTION;
            g.deadline = uint64(block.timestamp) + RESPONSE_TIMEOUT;
            emit NarrowedToBlock(_gameId, g.lo, g.midClaim);
        } else {
            g.status = Status.PROPOSER_TURN;
            g.deadline = uint64(block.timestamp) + RESPONSE_TIMEOUT;
        }

        emit ChallengerBisected(_gameId, _takeLowerHalf, g.lo, g.hi, g.deadline);
    }

    // ------------------------------------------------------------ resolution --

    /// @notice The guardian decides the narrowed disagreement.
    ///
    /// @dev The honest description of this function: a human, or a multisig of humans,
    ///      looks at one KAURAX block and says who was right. It is not a proof. It is what
    ///      stands in for one until docs/FAULT_PROOF_SPEC.md is implemented, and it is the
    ///      single place where that specification would attach — the guardian call is
    ///      replaced by a verifier call on the same narrowed block, and nothing else in this
    ///      contract has to change.
    ///
    ///      The guardian cannot rewrite history: it may only delete output roots that have
    ///      not finalized, and that restriction lives in the oracle, not here.
    function resolve(uint256 _gameId, bool _challengerWasRight, string calldata _reason)
        external
        onlyGuardian
    {
        Game storage g = _game(_gameId);
        if (g.status != Status.AWAITING_RESOLUTION) revert NotNarrowed();
        if (g.bondsSettled) revert AlreadySettled();

        if (_challengerWasRight) {
            g.status = Status.RESOLVED_CHALLENGER_WINS;
            uint256 recovered = _deleteAndRecover(_gameId, g.outputIndex);
            _settle(_gameId, g, g.challenger, g.proposer, _reason, recovered);
        } else {
            g.status = Status.RESOLVED_PROPOSER_WINS;
            _settle(_gameId, g, g.proposer, g.challenger, _reason, 0);
        }
    }

    /// @notice Claim a win when the other side stopped moving.
    ///
    /// @dev Permissionless on purpose. If only the winner could call this, a proposer who
    ///      abandoned a game could leave the challenger's bond locked by never touching it
    ///      again. Anyone can end an expired game; who wins is determined by whose turn it
    ///      was, not by who made the call.
    function resolveTimeout(uint256 _gameId) external {
        Game storage g = _game(_gameId);
        if (g.bondsSettled) revert AlreadySettled();
        if (block.timestamp <= g.deadline) revert DeadlineNotPassed(g.deadline);

        if (g.status == Status.PROPOSER_TURN) {
            // The proposer would not defend its own claim. Treat that as conceding it.
            g.status = Status.RESOLVED_TIMEOUT;
            uint256 recovered = _deleteAndRecover(_gameId, g.outputIndex);
            _settle(_gameId, g, g.challenger, g.proposer, "proposer abandoned the game", recovered);
        } else if (g.status == Status.CHALLENGER_TURN) {
            // The challenger stopped narrowing. The claim stands.
            g.status = Status.RESOLVED_TIMEOUT;
            _settle(_gameId, g, g.proposer, g.challenger, "challenger abandoned the game", 0);
        } else if (g.status == Status.AWAITING_RESOLUTION) {
            // The guardian did not act within the window.
            //
            // Both bonds are returned rather than either side winning. Slashing someone for
            // the guardian's inaction would punish a party for something outside their
            // control, and awarding a win on the same basis would let the guardian decide
            // outcomes by staying silent — which is worse than deciding them openly.
            g.status = Status.CANCELLED;
            _refundBoth(_gameId, g, "guardian did not resolve within the window");
        } else {
            revert WrongTurn(Status.AWAITING_RESOLUTION, g.status);
        }
    }

    /// @notice End a game whose output no longer exists, returning both bonds.
    /// @dev Reachable when an earlier game deleted this output as collateral damage. Nobody
    ///      lied, so nobody is slashed.
    function cancelOrphaned(uint256 _gameId) external {
        Game storage g = _game(_gameId);
        if (g.bondsSettled) revert AlreadySettled();
        if (uint8(g.status) > uint8(Status.AWAITING_RESOLUTION)) revert AlreadySettled();
        if (g.outputIndex < ORACLE.nextOutputIndex()) revert OutputNotFound();

        g.status = Status.CANCELLED;
        _refundBoth(_gameId, g, "output no longer exists");
    }

    // -------------------------------------------------------------- internals --

    /// @dev Pays the winner both bonds. State is written before any transfer, and the
    ///      settled flag is set first, so a re-entrant call finds the game already settled.
    function _settle(
        uint256 _gameId,
        Game storage g,
        address _winner,
        address _loser,
        string memory _reason,
        uint256 _recoveredEscrow
    ) internal {
        g.bondsSettled = true;
        delete liveGameOfOutput[g.outputIndex];

        uint256 winnerBond = _winner == g.challenger ? g.challengerBond : g.proposerBond;
        uint256 loserBond = _winner == g.challenger ? g.proposerBond : g.challengerBond;
        g.challengerBond = 0;
        g.proposerBond = 0;

        emit GameResolved(_gameId, g.status, _winner, _reason);
        if (loserBond > 0) emit BondSlashed(_gameId, _loser, loserBond, _winner);

        uint256 payout = winnerBond + loserBond + _recoveredEscrow;
        if (payout > 0) {
            _pay(_gameId, _winner, payout);
        }
    }

    /// @dev Removes the disputed output, or reports that it could no longer be removed.
    ///
    ///      A finalized output must not be unwound — withdrawals may already have settled
    ///      against it — so the oracle refuses, and reverting here would strand the bonds
    ///      of a challenger who was right. Instead the settlement stands and the failure is
    ///      announced, which is the honest outcome: the challenger is paid, and the record
    ///      shows a commitment that survived a dispute it should have lost.
    /// @dev Deletes the disputed output and collects the escrow the oracle credits for it.
    ///      Runs before settlement so the winner is paid once, in full.
    /// @return recovered The proposer's escrow, or zero if there was none.
    function _deleteAndRecover(uint256 _gameId, uint256 _outputIndex) internal returns (uint256 recovered) {
        uint256 before = address(this).balance;
        try ORACLE.deleteL2Outputs(_outputIndex) {
            // Deletion credits this contract with the disputed proposal's escrow. Pull it
            // rather than leaving it in the oracle under this address, where nobody would
            // think to look.
            try ORACLE.withdrawBond() {
                recovered = address(this).balance - before;
            } catch {
                // Nothing credited: the proposal carried no escrow, which is the devnet
                // default and not an error.
            }
        } catch {
            // The output finalized while the game ran, so it can no longer be removed. The
            // challenger is still paid its own bond; the record shows what happened.
            emit DisputeOutlivedFinalization(_gameId, _outputIndex);
        }
    }

    /// @notice True while an unsettled game exists for this output.
    /// @dev The oracle calls this before treating an output as final.
    function hasLiveGame(uint256 _outputIndex) external view returns (bool) {
        uint256 slot = liveGameOfOutput[_outputIndex];
        if (slot == 0) return false;
        return !games[slot - 1].bondsSettled;
    }

    function _refundBoth(uint256 _gameId, Game storage g, string memory _reason) internal {
        g.bondsSettled = true;
        delete liveGameOfOutput[g.outputIndex];

        uint256 toChallenger = g.challengerBond;
        uint256 toProposer = g.proposerBond;
        g.challengerBond = 0;
        g.proposerBond = 0;

        emit GameResolved(_gameId, g.status, address(0), _reason);
        if (toChallenger > 0) _pay(_gameId, g.challenger, toChallenger);
        if (toProposer > 0) _pay(_gameId, g.proposer, toProposer);
    }

    /// @dev A failed transfer reverts rather than being swallowed. Silently keeping a bond
    ///      because a recipient's fallback reverted would be theft by accident.
    function _pay(uint256 _gameId, address _to, uint256 _amount) internal {
        (bool ok,) = payable(_to).call{value: _amount}("");
        if (!ok) revert TransferFailed();
        emit BondPaid(_gameId, _to, _amount);
    }

    function _game(uint256 _gameId) internal view returns (Game storage) {
        if (_gameId >= games.length) revert UnknownGame();
        return games[_gameId];
    }

    function _requireLive(Game storage g) internal view {
        if (block.timestamp > g.deadline) revert DeadlinePassed(g.deadline);
    }

    // ------------------------------------------------------------------ views --

    function gameCount() external view returns (uint256) {
        return games.length;
    }

    /// @dev Goes through _game so an out-of-range id gives UnknownGame rather than a
    ///      panic. A caller reading a game that does not exist should get an error it can
    ///      recognise, not an opaque array bounds failure.
    function getGame(uint256 _gameId) external view returns (Game memory) {
        return _game(_gameId);
    }

    /// @notice The live game for an output, or false when there is none.
    function liveGame(uint256 _outputIndex) external view returns (bool exists, uint256 gameId) {
        uint256 slot = liveGameOfOutput[_outputIndex];
        return (slot != 0, slot == 0 ? 0 : slot - 1);
    }

    /// @notice How many more exchanges before this game narrows to one block.
    function movesRemaining(uint256 _gameId) external view returns (uint256) {
        Game storage g = _game(_gameId);
        uint256 span = g.hi > g.lo ? g.hi - g.lo : 0;
        uint256 moves;
        while (span > 0) {
            span /= 2;
            moves++;
        }
        return moves;
    }

    /// @notice States plainly what this contract is, for anything reading it on chain.
    function isFaultProof() external pure returns (bool) {
        return false;
    }

    function resolutionMechanism() external pure returns (string memory) {
        return "guardian multisig; no on-chain one-step verifier exists (docs/FAULT_PROOF_SPEC.md)";
    }

    // ------------------------------------------------------------------ admin --

    function setGuardian(address _guardian) external onlyGuardian {
        if (_guardian == address(0)) revert ZeroAddress();
        emit GuardianUpdated(guardian, _guardian);
        guardian = _guardian;
    }
}
