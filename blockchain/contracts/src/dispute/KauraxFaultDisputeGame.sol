// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {KauraxOneStepVerifier} from "../kvs/KauraxOneStepVerifier.sol";

/// @title KauraxFaultDisputeGame
/// @notice A dispute game that ends in arithmetic rather than in a person.
///
/// @dev ─────────────────────────────────────────────────────────────────────────────────
///      WHAT IS REAL HERE. Two bonded parties disagree about the result of executing a
///      program. The game bisects the disagreement — across blocks, then transactions, then
///      instructions — until exactly one instruction is in dispute. `proveStep` then hands
///      that instruction to `KauraxOneStepVerifier`, which executes it and decides. No
///      guardian, no multisig, no privileged caller, no signature. Anyone may submit the
///      proof, and the same proof gives the same answer to everyone.
///
///      WHAT IS NOT. This game adjudicates claims about the **KAURAX Verifiable Subset**, and
///      KAURAX's blocks are not executed on the KVS — they are executed by `anvil` over the
///      full EVM. It is therefore **deliberately not connected to KauraxL2OutputOracle**.
///      Connecting it would require an output root that commits to an execution trace, and
///      KAURAX's output roots commit to `(version, stateRoot, withdrawalTreeRoot, blockHash)`
///      instead. Wiring these together without that change would produce a contract that
///      looked like a fault proof over KAURAX state while proving something unrelated to it.
///
///      So: settlement disputes still go through `KauraxDisputeGame`, which is honest about
///      being guardian-resolved. This contract is the machine that replaces it once the
///      execution engine can produce traces. docs/FAULT_PROOFS.md states the gap; the
///      implementation report states what must change to close it.
///      ─────────────────────────────────────────────────────────────────────────────────
contract KauraxFaultDisputeGame {
    // ------------------------------------------------------------------- levels --

    /// @notice Narrowing proceeds through these in order. A level whose range reaches a
    ///         single unit descends into the next; the last level ends at the verifier.
    uint8 internal constant LEVEL_BLOCK = 0;
    uint8 internal constant LEVEL_TRANSACTION = 1;
    uint8 internal constant LEVEL_STEP = 2;

    /// @notice Upper bound on a declared sub-range, so a descent cannot demand an unbounded
    ///         number of bisection rounds. 2^40 units is ~40 exchanges.
    uint64 internal constant MAX_SUB_LENGTH = uint64(1) << 40;

    enum Status {
        NONE,
        PROPOSER_TURN,
        CHALLENGER_TURN,
        /// @notice Narrowed to one instruction. Anyone may now run it.
        AWAITING_PROOF,
        RESOLVED_PROPOSER_WINS,
        RESOLVED_CHALLENGER_WINS,
        RESOLVED_TIMEOUT
    }

    /// @notice A proposer's assertion that executing `length` units from `startClaim` ends
    ///         at `endClaim`. Claims are machine state hashes at every level.
    ///
    /// @dev The declared length is not security critical, which is worth stating because it
    ///      looks as though it should be. A length that is too small makes the verifier
    ///      disagree at the leaf; one that is too large lands the bisection in the trace's
    ///      terminal self-loop, which the verifier handles identically. Either way the
    ///      single instruction the game ends on decides the outcome. The bound above exists
    ///      to cap griefing, not to make the protocol sound.
    struct Claim {
        address proposer;
        bytes32 startClaim;
        bytes32 endClaim;
        uint64 length;
        uint256 bond;
        bool challenged;
        bool withdrawn;
    }

    struct Game {
        uint256 claimId;
        address challenger;
        address proposer;
        uint8 level;
        uint64 lo;
        uint64 hi;
        /// @dev Invariant, and the whole reason the game converges: the parties AGREE on the
        ///      state at `lo` and DISAGREE about the state at `hi`.
        bytes32 loClaim;
        bytes32 hiClaim;
        bytes32 midClaim;
        uint64 deadline;
        uint256 challengerBond;
        uint256 proposerBond;
        Status status;
        bool settled;
    }

    // ------------------------------------------------------------ configuration --

    KauraxOneStepVerifier public immutable VERIFIER;
    uint256 public immutable PROPOSER_BOND;
    uint256 public immutable CHALLENGER_BOND;
    uint64 public immutable RESPONSE_TIMEOUT;
    /// @notice How long a claim must stand unchallenged before its bond is returnable.
    uint64 public immutable CLAIM_MATURITY;

    Claim[] internal claims;
    Game[] internal games;

    /// @notice Settlement proceeds owed to a party, claimable with `withdraw`.
    ///
    /// @dev Pull, not push. Paying the winner inside `proveStep` meant a winner that
    ///      rejects ETH — a contract with no payable fallback, deliberately or not — made
    ///      settlement revert. Since `proveStep` is permissionless and the game cannot be
    ///      resolved any other way once it reaches the leaf, that locked both bonds forever
    ///      and handed a challenger a way to grief a proposer at the cost of its own bond.
    ///      Crediting first and letting the payee pull removes the failure from the path
    ///      that has to succeed.
    mapping(address => uint256) public withdrawable;

    // ------------------------------------------------------------------- events --

    event ClaimPosted(
        uint256 indexed claimId, address indexed proposer, bytes32 startClaim, bytes32 endClaim, uint64 length
    );
    event ClaimWithdrawn(uint256 indexed claimId, address indexed proposer, uint256 bond);
    event GameOpened(uint256 indexed gameId, uint256 indexed claimId, address indexed challenger);
    event Defended(uint256 indexed gameId, uint8 level, uint64 mid, bytes32 midClaim, uint64 deadline);
    event Disputed(uint256 indexed gameId, bool agreedWithMid, uint64 lo, uint64 hi, uint64 deadline);
    event Descended(uint256 indexed gameId, uint8 level, uint64 length, bytes32 loClaim, bytes32 hiClaim);
    event NarrowedToStep(uint256 indexed gameId, bytes32 preState, bytes32 disputedPostState);
    event StepProven(
        uint256 indexed gameId, bytes32 verifierPostState, bytes32 claimedPostState, bool proposerWasRight
    );
    event Resolved(uint256 indexed gameId, Status status, address indexed winner, string reason);
    event Credited(address indexed to, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    // ------------------------------------------------------------------- errors --

    error ZeroAddress();
    error InvalidConfiguration();
    error UnknownClaim();
    error UnknownGame();
    error WrongBond(uint256 expected, uint256 got);
    error WrongTurn(Status expected, Status actual);
    error AlreadyChallenged();
    error AlreadySettled();
    error ClaimNotMature(uint64 maturesAt);
    error DeadlinePassed(uint64 deadline);
    error DeadlineNotPassed(uint64 deadline);
    error NotProposer();
    error NotChallenger();
    error NotNarrowed();
    error NotAtStepLevel();
    error StillBisecting();
    error LengthOutOfRange(uint64 length);
    error TransferFailed();
    error NothingToWithdraw();

    constructor(
        address _verifier,
        uint256 _proposerBond,
        uint256 _challengerBond,
        uint64 _responseTimeout,
        uint64 _claimMaturity
    ) {
        if (_verifier == address(0)) revert ZeroAddress();
        // Free claims and free challenges both make griefing free, in opposite directions.
        if (_proposerBond == 0 || _challengerBond == 0) revert InvalidConfiguration();
        // A zero response window means the first mover wins by default.
        if (_responseTimeout == 0) revert InvalidConfiguration();
        // A claim that matures before a challenger can realistically act is unchallengeable
        // in practice, whatever the code says.
        if (_claimMaturity <= _responseTimeout) revert InvalidConfiguration();

        VERIFIER = KauraxOneStepVerifier(_verifier);
        PROPOSER_BOND = _proposerBond;
        CHALLENGER_BOND = _challengerBond;
        RESPONSE_TIMEOUT = _responseTimeout;
        CLAIM_MATURITY = _claimMaturity;
    }

    // -------------------------------------------------------------------- claims --

    /// @notice Assert that executing `_length` units from `_startClaim` ends at `_endClaim`.
    function postClaim(bytes32 _startClaim, bytes32 _endClaim, uint64 _length)
        external
        payable
        returns (uint256 claimId)
    {
        if (msg.value != PROPOSER_BOND) revert WrongBond(PROPOSER_BOND, msg.value);
        if (_length == 0 || _length > MAX_SUB_LENGTH) revert LengthOutOfRange(_length);

        claimId = claims.length;
        claims.push(
            Claim({
                proposer: msg.sender,
                startClaim: _startClaim,
                endClaim: _endClaim,
                length: _length,
                bond: msg.value,
                challenged: false,
                withdrawn: false
            })
        );
        // Maturity is measured from posting, so the window is the same for every claim and
        // does not depend on when anyone happens to look.
        claimTime[claimId] = uint64(block.timestamp);
        emit ClaimPosted(claimId, msg.sender, _startClaim, _endClaim, _length);
    }

    mapping(uint256 => uint64) public claimTime;

    /// @notice Reclaim the bond behind a claim nobody disputed.
    function withdrawClaimBond(uint256 _claimId) external {
        Claim storage c = _claim(_claimId);
        if (c.proposer != msg.sender) revert NotProposer();
        if (c.withdrawn) revert AlreadySettled();
        if (c.challenged) revert AlreadyChallenged();

        uint64 matures = claimTime[_claimId] + CLAIM_MATURITY;
        if (block.timestamp < matures) revert ClaimNotMature(matures);

        c.withdrawn = true;
        uint256 amount = c.bond;
        c.bond = 0;
        emit ClaimWithdrawn(_claimId, msg.sender, amount);
        _pay(msg.sender, amount);
    }

    // --------------------------------------------------------------------- game --

    /// @notice Dispute a claim. Permissionless; the bond is the only gate.
    function challenge(uint256 _claimId) external payable returns (uint256 gameId) {
        if (msg.value != CHALLENGER_BOND) revert WrongBond(CHALLENGER_BOND, msg.value);
        Claim storage c = _claim(_claimId);
        if (c.challenged) revert AlreadyChallenged();
        if (c.withdrawn) revert AlreadySettled();
        // A proposer challenging itself would let it burn a bond to lock its own claim
        // against a real challenger, since only one game per claim is allowed.
        if (c.proposer == msg.sender) revert NotChallenger();

        c.challenged = true;

        gameId = games.length;
        games.push(
            Game({
                claimId: _claimId,
                challenger: msg.sender,
                proposer: c.proposer,
                level: LEVEL_BLOCK,
                lo: 0,
                hi: c.length,
                loClaim: c.startClaim,
                hiClaim: c.endClaim,
                midClaim: bytes32(0),
                deadline: uint64(block.timestamp) + RESPONSE_TIMEOUT,
                challengerBond: msg.value,
                proposerBond: c.bond,
                status: Status.PROPOSER_TURN,
                settled: false
            })
        );
        c.bond = 0; // escrow moves into the game

        emit GameOpened(gameId, _claimId, msg.sender);
        _maybeNarrow(gameId, games[gameId]);
    }

    /// @notice The proposer states its claim at the midpoint of the disputed range.
    function defend(uint256 _gameId, bytes32 _midClaim) external {
        Game storage g = _game(_gameId);
        if (msg.sender != g.proposer) revert NotProposer();
        if (g.status != Status.PROPOSER_TURN) revert WrongTurn(Status.PROPOSER_TURN, g.status);
        _requireLive(g);

        uint64 mid = _mid(g);
        g.midClaim = _midClaim;
        g.status = Status.CHALLENGER_TURN;
        g.deadline = uint64(block.timestamp) + RESPONSE_TIMEOUT;
        emit Defended(_gameId, g.level, mid, _midClaim, g.deadline);
    }

    /// @notice The challenger says whether it agrees with the midpoint claim.
    ///
    /// @dev This is what makes the game converge, and it is the piece the guardian-based
    ///      game lacks. Agreement moves the agreed boundary up; disagreement moves the
    ///      disputed boundary down. Either way the invariant "agreed at lo, disputed at hi"
    ///      survives, so the leaf is always a transition both sides have pinned: one
    ///      agreed pre-state, one disputed post-state. That is exactly the verifier's input.
    function dispute(uint256 _gameId, bool _agreeWithMid) external {
        Game storage g = _game(_gameId);
        if (msg.sender != g.challenger) revert NotChallenger();
        if (g.status != Status.CHALLENGER_TURN) revert WrongTurn(Status.CHALLENGER_TURN, g.status);
        _requireLive(g);

        uint64 mid = _mid(g);
        if (_agreeWithMid) {
            g.lo = mid;
            g.loClaim = g.midClaim;
        } else {
            g.hi = mid;
            g.hiClaim = g.midClaim;
        }
        g.status = Status.PROPOSER_TURN;
        g.deadline = uint64(block.timestamp) + RESPONSE_TIMEOUT;
        emit Disputed(_gameId, _agreeWithMid, g.lo, g.hi, g.deadline);

        _maybeNarrow(_gameId, g);
    }

    /// @notice Descend into the single disputed unit, declaring how many sub-units it holds.
    function descend(uint256 _gameId, uint64 _subLength) external {
        Game storage g = _game(_gameId);
        if (msg.sender != g.proposer) revert NotProposer();
        if (g.status != Status.PROPOSER_TURN) revert WrongTurn(Status.PROPOSER_TURN, g.status);
        if (g.hi != g.lo + 1) revert StillBisecting();
        if (g.level >= LEVEL_STEP) revert NotAtStepLevel();
        if (_subLength == 0 || _subLength > MAX_SUB_LENGTH) revert LengthOutOfRange(_subLength);
        _requireLive(g);

        // The claims carry over unchanged: the state before the unit is still agreed, the
        // state after it is still disputed. Only the granularity changes.
        g.level += 1;
        g.lo = 0;
        g.hi = _subLength;
        g.midClaim = bytes32(0);
        g.deadline = uint64(block.timestamp) + RESPONSE_TIMEOUT;

        emit Descended(_gameId, g.level, _subLength, g.loClaim, g.hiClaim);
        _maybeNarrow(_gameId, g);
    }

    /// @notice Run the single disputed instruction and settle the game on the result.
    ///
    /// @dev Permissionless. The verifier is a pure function of its inputs, so who submits
    ///      the proof cannot change the answer — and requiring a particular party to submit
    ///      it would hand that party the ability to stall by not submitting.
    function proveStep(uint256 _gameId, KauraxOneStepVerifier.StepProof calldata _proof) external {
        Game storage g = _game(_gameId);
        if (g.settled) revert AlreadySettled();
        if (g.status != Status.AWAITING_PROOF) revert NotNarrowed();

        bytes32 post = VERIFIER.step(g.loClaim, _proof);
        bool proposerWasRight = post == g.hiClaim;

        emit StepProven(_gameId, post, g.hiClaim, proposerWasRight);

        if (proposerWasRight) {
            g.status = Status.RESOLVED_PROPOSER_WINS;
            _settle(_gameId, g, g.proposer, "the verifier reproduced the proposer's state");
        } else {
            g.status = Status.RESOLVED_CHALLENGER_WINS;
            _settle(_gameId, g, g.challenger, "the verifier contradicted the proposer's state");
        }
    }

    /// @notice Claim a win when the other side stopped moving.
    /// @dev Permissionless: if only the winner could call it, an abandoning party could
    ///      lock the other's bond by never touching the game again.
    function resolveTimeout(uint256 _gameId) external {
        Game storage g = _game(_gameId);
        if (g.settled) revert AlreadySettled();
        if (block.timestamp <= g.deadline) revert DeadlineNotPassed(g.deadline);

        if (g.status == Status.PROPOSER_TURN) {
            g.status = Status.RESOLVED_TIMEOUT;
            _settle(_gameId, g, g.challenger, "proposer abandoned the game");
        } else if (g.status == Status.CHALLENGER_TURN) {
            g.status = Status.RESOLVED_TIMEOUT;
            _settle(_gameId, g, g.proposer, "challenger abandoned the game");
        } else if (g.status == Status.AWAITING_PROOF) {
            // Nobody ran the instruction. The claim was never disproved, so it stands —
            // and because submitting the proof is permissionless, a challenger who was
            // right had every opportunity to do it.
            g.status = Status.RESOLVED_TIMEOUT;
            _settle(_gameId, g, g.proposer, "no step proof was submitted in time");
        } else {
            revert WrongTurn(Status.AWAITING_PROOF, g.status);
        }
    }

    // ----------------------------------------------------------------- internals --

    /// @dev Called after every narrowing move. When a level reaches one unit the game either
    ///      descends (proposer's move) or, at the bottom, waits for the proof.
    function _maybeNarrow(uint256 _gameId, Game storage g) internal {
        if (g.hi != g.lo + 1) return;
        if (g.level == LEVEL_STEP) {
            g.status = Status.AWAITING_PROOF;
            g.deadline = uint64(block.timestamp) + RESPONSE_TIMEOUT;
            emit NarrowedToStep(_gameId, g.loClaim, g.hiClaim);
        } else {
            g.status = Status.PROPOSER_TURN;
            g.deadline = uint64(block.timestamp) + RESPONSE_TIMEOUT;
        }
    }

    function _mid(Game storage g) internal view returns (uint64) {
        return g.lo + (g.hi - g.lo) / 2;
    }

    function _settle(uint256 _gameId, Game storage g, address _winner, string memory _reason) internal {
        g.settled = true;
        uint256 payout = g.challengerBond + g.proposerBond;
        g.challengerBond = 0;
        g.proposerBond = 0;
        emit Resolved(_gameId, g.status, _winner, _reason);
        if (payout > 0) {
            withdrawable[_winner] += payout;
            emit Credited(_winner, payout);
        }
    }

    /// @notice Collect settlement proceeds.
    /// @dev State is cleared before the transfer, so a re-entrant caller finds nothing left.
    function withdraw() external {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        withdrawable[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        _pay(msg.sender, amount);
    }

    // slither-disable-next-line arbitrary-send-eth
    function _pay(address _to, uint256 _amount) internal {
        // slither-disable-next-line arbitrary-send-eth
        // Reached only from `withdraw`, where `_to` is msg.sender and their credit is zeroed
        // before this runs. The address is the caller's own, not one they chose for someone
        // else's funds.
        (bool ok,) = payable(_to).call{value: _amount}("");
        if (!ok) revert TransferFailed();
    }

    function _requireLive(Game storage g) internal view {
        if (g.settled) revert AlreadySettled();
        if (block.timestamp > g.deadline) revert DeadlinePassed(g.deadline);
    }

    function _game(uint256 _id) internal view returns (Game storage) {
        if (_id >= games.length) revert UnknownGame();
        return games[_id];
    }

    function _claim(uint256 _id) internal view returns (Claim storage) {
        if (_id >= claims.length) revert UnknownClaim();
        return claims[_id];
    }

    // -------------------------------------------------------------------- views --

    function gameCount() external view returns (uint256) {
        return games.length;
    }

    function claimCount() external view returns (uint256) {
        return claims.length;
    }

    function getGame(uint256 _id) external view returns (Game memory) {
        return _game(_id);
    }

    function getClaim(uint256 _id) external view returns (Claim memory) {
        return _claim(_id);
    }

    /// @notice True — and unlike `KauraxDisputeGame`, this one means it.
    /// @dev Scoped by `scope()`, which says what the proof is *about*. A caller that reads
    ///      this without reading that has been told half the truth, so both are here.
    function isFaultProof() external pure returns (bool) {
        return true;
    }

    function scope() external pure returns (string memory) {
        return "Resolves disputes about the KAURAX Verifiable Subset via an on-chain one-step "
            "verifier. NOT connected to KauraxL2OutputOracle: KAURAX output roots do not commit "
            "to an execution trace, and KAURAX blocks run on the full EVM, not the KVS. "
            "Settlement disputes remain guardian-resolved in KauraxDisputeGame. " "See docs/FAULT_PROOFS.md";
    }

    function resolutionMechanism() external pure returns (string memory) {
        return "on-chain one-step verifier; no guardian, no privileged caller";
    }
}
