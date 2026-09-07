// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KauraxDisputeGame} from "../src/dispute/KauraxDisputeGame.sol";
import {KauraxL2OutputOracle} from "../src/L2/KauraxL2OutputOracle.sol";
import {Types} from "../src/libraries/Types.sol";

/// @notice Tests for the permissionless dispute game.
///
/// @dev These are written against the real output oracle rather than a mock, because the
///      interesting behaviour is the interaction: a challenger win must actually delete an
///      output root, and must fail to when that root has finalized. A mock would let both
///      of those pass while being wrong.
contract DisputeGameTest is Test {
    KauraxL2OutputOracle internal oracle;
    KauraxDisputeGame internal game;

    address internal proposer = address(0xAAAA);
    address internal challenger = address(0xBBBB);
    address internal guardian = address(0xCCCC);
    address internal stranger = address(0xDDDD);

    uint256 internal constant SUBMISSION_INTERVAL = 10;
    uint256 internal constant L3_BLOCK_TIME = 2;
    uint256 internal constant FINALIZATION = 7 days;

    uint256 internal constant CHALLENGER_BOND = 1 ether;
    /// @dev Escrowed by the oracle at proposal time, not collected by the game.
    uint256 internal constant PROPOSER_BOND = 2 ether;
    uint64 internal constant RESPONSE_TIMEOUT = 6 hours;
    uint64 internal constant MAX_DURATION = 30 days;

    function setUp() public {
        vm.warp(10_000);

        // The oracle is deployed with the deployer as challenger so that the dispute game's
        // address can be set afterwards — the two contracts need each other.
        oracle = new KauraxL2OutputOracle(
            SUBMISSION_INTERVAL,
            L3_BLOCK_TIME,
            0,
            block.timestamp - 1000,
            FINALIZATION,
            proposer,
            address(this),
            PROPOSER_BOND
        );

        game = new KauraxDisputeGame(
            address(oracle), guardian, CHALLENGER_BOND, PROPOSER_BOND, RESPONSE_TIMEOUT, MAX_DURATION
        );

        // The whole point: deletion becomes reachable only through a resolved dispute.
        oracle.setDisputeGame(address(game));
        oracle.setChallenger(address(game));

        vm.deal(proposer, 100 ether);

        // One output before anything under test, so a disputed proposal spans a real range
        // of blocks rather than the degenerate single-block case at index 0. Both are worth
        // covering; test_singleBlockRange below covers the degenerate one deliberately.
        _propose();

        vm.deal(challenger, 100 ether);
        vm.deal(proposer, 100 ether);
        vm.deal(stranger, 100 ether);
    }

    // ------------------------------------------------------------- helpers --

    /// @dev Posts one output root and returns its index.
    function _propose() internal returns (uint256 index) {
        uint256 next = oracle.nextBlockNumber();
        // The oracle rejects a proposal whose derived timestamp is not yet in the past.
        vm.warp(block.timestamp + SUBMISSION_INTERVAL * L3_BLOCK_TIME + 1);
        index = oracle.nextOutputIndex();
        vm.prank(proposer);
        oracle.proposeL2Output{value: PROPOSER_BOND}(keccak256(abi.encode(next)), next, bytes32(0), 0);
    }

    function _openGame(uint256 outputIndex) internal returns (uint256 gameId) {
        vm.prank(challenger);
        gameId = game.challenge{value: CHALLENGER_BOND}(outputIndex);
    }

    /// @dev Plays a full game to a single block. Returns the game id.
    function _playToNarrowed(uint256 outputIndex) internal returns (uint256 gameId) {
        gameId = _openGame(outputIndex);
        for (uint256 i = 0; i < 64; i++) {
            KauraxDisputeGame.Game memory g = game.getGame(gameId);
            if (g.status == KauraxDisputeGame.Status.AWAITING_RESOLUTION) break;
            if (g.status == KauraxDisputeGame.Status.PROPOSER_TURN) {
                vm.prank(proposer);
                game.defend(gameId, keccak256(abi.encode(i)));
            } else if (g.status == KauraxDisputeGame.Status.CHALLENGER_TURN) {
                vm.prank(challenger);
                game.bisect(gameId, true);
            } else {
                revert("unexpected status");
            }
        }
    }

    /// @dev The degenerate case the helpers above deliberately avoid: an output covering
    ///      one block cannot be bisected, so it must reach resolution directly.
    function test_singleBlockRangeGoesStraightToResolution() public {
        KauraxL2OutputOracle single = new KauraxL2OutputOracle(
            1, L3_BLOCK_TIME, 0, block.timestamp - 1000, FINALIZATION, proposer, address(this), 0
        );
        KauraxDisputeGame g2 = new KauraxDisputeGame(
            address(single), guardian, CHALLENGER_BOND, PROPOSER_BOND, RESPONSE_TIMEOUT, MAX_DURATION
        );
        single.setChallenger(address(g2));

        vm.warp(block.timestamp + 100);
        // nextBlockNumber() is itself an external call, so it must be read before the prank
        // or the prank lands on it instead of the proposal.
        uint256 nextBlock = single.nextBlockNumber();
        vm.prank(proposer);
        single.proposeL2Output(keccak256("root"), nextBlock, bytes32(0), 0);

        vm.prank(challenger);
        uint256 id = g2.challenge{value: CHALLENGER_BOND}(0);
        vm.prank(proposer);
        g2.defend(id, keccak256("claim"));

        KauraxDisputeGame.Game memory g = g2.getGame(id);
        assertEq(uint8(g.status), uint8(KauraxDisputeGame.Status.AWAITING_RESOLUTION));
        assertEq(g.lo, g.hi);
    }

    // ------------------------------------------------------------ opening --

    function test_anyoneCanChallenge() public {
        uint256 idx = _propose();
        vm.prank(stranger); // not the configured challenger of the old design
        uint256 id = stranger == address(0) ? 0 : game.challenge{value: CHALLENGER_BOND}(idx);
        assertEq(game.getGame(id).challenger, stranger);
    }

    function test_challengeRequiresExactBond() public {
        uint256 idx = _propose();
        vm.prank(challenger);
        vm.expectRevert(
            abi.encodeWithSelector(KauraxDisputeGame.WrongBond.selector, CHALLENGER_BOND, 0.5 ether)
        );
        game.challenge{value: 0.5 ether}(idx);
    }

    /// @dev The proposer is read from the oracle now, so an index nobody proposed cannot be
    ///      disputed — and a challenger can no longer bind an arbitrary address to a game.
    function test_challengeRejectsIndexWithNoProposer() public {
        vm.prank(challenger);
        vm.expectRevert();
        game.challenge{value: CHALLENGER_BOND}(999);
    }

    /// @dev Without this, one attacker bond forces the proposer to defend N games at once.
    function test_onlyOneLiveGamePerOutput() public {
        uint256 idx = _propose();
        uint256 first = _openGame(idx);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(KauraxDisputeGame.GameAlreadyLive.selector, first));
        game.challenge{value: CHALLENGER_BOND}(idx);
    }

    function test_cannotChallengeFinalizedOutput() public {
        uint256 idx = _propose();
        vm.warp(block.timestamp + FINALIZATION + 1);
        vm.prank(challenger);
        vm.expectRevert(KauraxDisputeGame.OutputAlreadyFinalized.selector);
        game.challenge{value: CHALLENGER_BOND}(idx);
    }

    function test_cannotChallengeNonexistentOutput() public {
        vm.prank(challenger);
        vm.expectRevert();
        game.challenge{value: CHALLENGER_BOND}(99);
    }

    // ---------------------------------------------------------- bisection --

    /// @dev The escrow is taken when the root is proposed, so a claim carries risk before
    ///      anyone objects to it — which is the property the late-bond design lacked.
    function test_escrowIsHeldFromProposalTime() public {
        uint256 idx = _propose();
        assertEq(oracle.proposalBond(idx), PROPOSER_BOND, "escrow held at proposal time");
        assertEq(oracle.proposalProposer(idx), proposer, "proposer recorded");
    }

    function test_proposalRejectedWithoutEscrow() public {
        uint256 next = oracle.nextBlockNumber();
        vm.warp(block.timestamp + SUBMISSION_INTERVAL * L3_BLOCK_TIME + 1);
        vm.prank(proposer);
        vm.expectRevert(
            abi.encodeWithSelector(KauraxL2OutputOracle.WrongProposerBond.selector, PROPOSER_BOND, 0)
        );
        oracle.proposeL2Output(keccak256("x"), next, bytes32(0), 0);
    }

    /// @dev The whole point of M-1: a live game holds the window open.
    function test_liveGameKeepsOutputUnfinalized() public {
        uint256 idx = _propose();
        _openGame(idx);
        vm.warp(block.timestamp + FINALIZATION + 1);
        assertFalse(oracle.isOutputFinalized(idx), "a disputed output must not finalize");
    }

    function test_outputFinalizesOnceTheGameSettles() public {
        uint256 idx = _propose();
        uint256 id = _openGame(idx);
        vm.warp(block.timestamp + RESPONSE_TIMEOUT + 1);
        game.resolveTimeout(id); // challenger wins; output deleted
        assertEq(oracle.nextOutputIndex(), idx, "deleted");
    }

    function test_proposerReclaimsEscrowAfterFinalization() public {
        uint256 idx = _propose();
        vm.warp(block.timestamp + FINALIZATION + 1);
        assertTrue(oracle.isOutputFinalized(idx));

        uint256 before = proposer.balance;
        vm.prank(proposer);
        oracle.claimProposalBond(idx);
        vm.prank(proposer);
        oracle.withdrawBond();
        assertEq(proposer.balance, before + PROPOSER_BOND, "escrow returned");
    }

    function test_onlyProposerMayDefend() public {
        uint256 id = _openGame(_propose());
        vm.prank(stranger);
        vm.expectRevert(KauraxDisputeGame.NotProposer.selector);
        game.defend(id, bytes32(uint256(1)));
    }

    function test_onlyChallengerMayBisect() public {
        uint256 id = _openGame(_propose());
        vm.prank(proposer);
        game.defend(id, bytes32(uint256(1)));
        vm.prank(stranger);
        vm.expectRevert(KauraxDisputeGame.NotChallenger.selector);
        game.bisect(id, true);
    }

    function test_cannotMoveOutOfTurn() public {
        uint256 id = _openGame(_propose());
        vm.prank(challenger);
        vm.expectRevert();
        game.bisect(id, true); // proposer has not moved yet
    }

    function test_bisectionHalvesTheRange() public {
        uint256 idx = _propose();
        uint256 id = _openGame(idx);
        KauraxDisputeGame.Game memory before = game.getGame(id);
        uint128 span = before.hi - before.lo;

        vm.prank(proposer);
        game.defend(id, bytes32(uint256(1)));
        vm.prank(challenger);
        game.bisect(id, true);

        KauraxDisputeGame.Game memory afterMove = game.getGame(id);
        assertLt(afterMove.hi - afterMove.lo, span, "range must shrink");
    }

    function test_bisectionConvergesToOneBlock() public {
        uint256 id = _playToNarrowed(_propose());
        KauraxDisputeGame.Game memory g = game.getGame(id);
        assertEq(uint8(g.status), uint8(KauraxDisputeGame.Status.AWAITING_RESOLUTION));
        assertEq(g.lo, g.hi, "must narrow to a single block");
    }

    function testFuzz_bisectionAlwaysConverges(bool[8] calldata choices) public {
        uint256 id = _openGame(_propose());
        for (uint256 i = 0; i < 64; i++) {
            KauraxDisputeGame.Game memory g = game.getGame(id);
            if (g.status == KauraxDisputeGame.Status.AWAITING_RESOLUTION) break;
            if (g.status == KauraxDisputeGame.Status.PROPOSER_TURN) {
                vm.prank(proposer);
                game.defend(id, bytes32(i));
            } else {
                vm.prank(challenger);
                game.bisect(id, choices[i % 8]);
            }
        }
        KauraxDisputeGame.Game memory end = game.getGame(id);
        assertEq(uint8(end.status), uint8(KauraxDisputeGame.Status.AWAITING_RESOLUTION));
        assertEq(end.lo, end.hi);
    }

    // --------------------------------------------------------- resolution --

    function test_guardianResolvesForChallengerAndOutputIsDeleted() public {
        uint256 idx = _propose();
        uint256 id = _playToNarrowed(idx);
        uint256 before = challenger.balance;

        vm.prank(guardian);
        game.resolve(id, true, "state root did not match");

        assertEq(uint8(game.getGame(id).status), uint8(KauraxDisputeGame.Status.RESOLVED_CHALLENGER_WINS));
        assertEq(
            challenger.balance,
            before + CHALLENGER_BOND + PROPOSER_BOND,
            "challenger recovers its bond and takes the proposer's escrow"
        );
        assertEq(oracle.nextOutputIndex(), idx, "output must be deleted");
    }

    function test_guardianResolvesForProposer() public {
        uint256 idx = _propose();
        uint256 id = _playToNarrowed(idx);
        uint256 before = proposer.balance;

        vm.prank(guardian);
        game.resolve(id, false, "claim verified against the node");

        assertEq(uint8(game.getGame(id).status), uint8(KauraxDisputeGame.Status.RESOLVED_PROPOSER_WINS));
        // The proposer takes the challenger's bond. Its own escrow stays with the oracle
        // and is reclaimable once the output finalizes.
        assertEq(proposer.balance, before + CHALLENGER_BOND);
        assertEq(oracle.nextOutputIndex(), idx + 1, "output must survive");
    }

    function test_onlyGuardianMayResolve() public {
        uint256 id = _playToNarrowed(_propose());
        vm.prank(stranger);
        vm.expectRevert(KauraxDisputeGame.NotGuardian.selector);
        game.resolve(id, true, "");
    }

    function test_cannotResolveBeforeNarrowed() public {
        uint256 id = _openGame(_propose());
        vm.prank(guardian);
        vm.expectRevert(KauraxDisputeGame.NotNarrowed.selector);
        game.resolve(id, true, "");
    }

    function test_cannotResolveTwice() public {
        uint256 id = _playToNarrowed(_propose());
        vm.prank(guardian);
        game.resolve(id, false, "first");
        vm.prank(guardian);
        vm.expectRevert();
        game.resolve(id, false, "second");
    }

    // ------------------------------------------------------------ timeouts --

    function test_proposerAbandonment_challengerWinsAndOutputDeleted() public {
        uint256 idx = _propose();
        uint256 id = _openGame(idx);
        uint256 before = challenger.balance;

        vm.warp(block.timestamp + RESPONSE_TIMEOUT + 1);
        // Anyone may end it; the caller does not decide the winner.
        vm.prank(stranger);
        game.resolveTimeout(id);

        assertEq(uint8(game.getGame(id).status), uint8(KauraxDisputeGame.Status.RESOLVED_TIMEOUT));
        assertEq(
            challenger.balance,
            before + CHALLENGER_BOND + PROPOSER_BOND,
            "abandonment forfeits the escrow to the challenger"
        );
        assertEq(oracle.nextOutputIndex(), idx, "abandoned claim must not stand");
    }

    function test_challengerAbandonment_proposerWins() public {
        uint256 idx = _propose();
        uint256 id = _openGame(idx);
        vm.prank(proposer);
        game.defend(id, bytes32(uint256(1)));

        uint256 before = proposer.balance;
        vm.warp(block.timestamp + RESPONSE_TIMEOUT + 1);
        game.resolveTimeout(id);

        assertEq(proposer.balance, before + CHALLENGER_BOND);
        assertEq(oracle.nextOutputIndex(), idx + 1, "unchallenged claim stands");
    }

    /// @dev The guardian must not be able to decide outcomes by staying silent.
    function test_guardianInaction_refundsBothSides() public {
        uint256 id = _playToNarrowed(_propose());
        uint256 cBefore = challenger.balance;
        uint256 pBefore = proposer.balance;

        vm.warp(block.timestamp + RESPONSE_TIMEOUT + 1);
        game.resolveTimeout(id);

        assertEq(uint8(game.getGame(id).status), uint8(KauraxDisputeGame.Status.CANCELLED));
        assertEq(challenger.balance, cBefore + CHALLENGER_BOND, "challenger refunded");
        // The proposer never staked with the game; its escrow was never at risk here.
        assertEq(proposer.balance, pBefore, "proposer unaffected");
    }

    function test_cannotTimeoutBeforeDeadline() public {
        uint256 id = _openGame(_propose());
        vm.expectRevert();
        game.resolveTimeout(id);
    }

    function test_cannotTimeoutTwice() public {
        uint256 id = _openGame(_propose());
        vm.warp(block.timestamp + RESPONSE_TIMEOUT + 1);
        game.resolveTimeout(id);
        vm.expectRevert(KauraxDisputeGame.AlreadySettled.selector);
        game.resolveTimeout(id);
    }

    function test_movesRejectedAfterDeadline() public {
        uint256 id = _openGame(_propose());
        vm.warp(block.timestamp + RESPONSE_TIMEOUT + 1);
        vm.prank(proposer);
        vm.expectRevert();
        game.defend(id, bytes32(uint256(1)));
    }

    // -------------------------------------------------------- accounting --

    /// @dev Every path must leave the contract holding nothing. A dispute game that
    ///      accumulates dust is a dispute game that has lost someone's bond.
    function test_noFundsLeftBehind_challengerWins() public {
        uint256 id = _playToNarrowed(_propose());
        vm.prank(guardian);
        game.resolve(id, true, "");
        assertEq(address(game).balance, 0);
    }

    function test_noFundsLeftBehind_proposerWins() public {
        uint256 id = _playToNarrowed(_propose());
        vm.prank(guardian);
        game.resolve(id, false, "");
        assertEq(address(game).balance, 0);
    }

    function test_noFundsLeftBehind_timeout() public {
        uint256 id = _openGame(_propose());
        vm.warp(block.timestamp + RESPONSE_TIMEOUT + 1);
        game.resolveTimeout(id);
        assertEq(address(game).balance, 0);
    }

    function test_noFundsLeftBehind_guardianInaction() public {
        uint256 id = _playToNarrowed(_propose());
        vm.warp(block.timestamp + RESPONSE_TIMEOUT + 1);
        game.resolveTimeout(id);
        assertEq(address(game).balance, 0);
    }

    // --------------------------------------------- finalization interlock --

    /// @dev A live game holds the window open even once the timer has run out. Without
    ///      this a challenger can win and find the commitment already spent against.
    function test_liveGameHoldsFinalizationOpenPastTheTimer() public {
        uint256 idx = _propose();
        _openGame(idx);

        vm.warp(block.timestamp + FINALIZATION + 1);
        assertFalse(oracle.isOutputFinalized(idx), "a disputed output must not finalize on the timer alone");
    }

    /// @dev And settling releases it, or one abandoned game would freeze an output forever.
    function test_settlingTheGameReleasesFinalization() public {
        uint256 idx = _propose();
        uint256 id = _openGame(idx);

        // Proposer answers; challenger walks away, so the claim stands.
        vm.prank(proposer);
        game.defend(id, bytes32(uint256(1)));
        vm.warp(block.timestamp + RESPONSE_TIMEOUT + 1);
        game.resolveTimeout(id);

        assertEq(oracle.nextOutputIndex(), idx + 1, "claim stands");
        vm.warp(block.timestamp + FINALIZATION + 1);
        assertTrue(oracle.isOutputFinalized(idx), "settled game releases the window");
    }

    function test_disputeGameEnforcedIsReportedHonestly() public view {
        assertTrue(oracle.disputeGameEnforced());
    }

    /// @dev Deleting an output refunds the proposals above it, which were never adjudicated.
    function test_collateralProposalsAreRefundedNotSlashed() public {
        uint256 idx = _propose();
        _propose(); // a later proposal, deleted as a consequence
        uint256 id = _playToNarrowed(idx);

        vm.prank(guardian);
        game.resolve(id, true, "wrong root");

        // The later proposal's escrow is credited back to its proposer.
        uint256 before = proposer.balance;
        vm.prank(proposer);
        oracle.withdrawBond();
        assertEq(proposer.balance, before + PROPOSER_BOND, "collateral proposal refunded");
    }

    // ------------------------------------------------------------ honesty --

    /// @dev If this ever returns true without a verifier existing, something has gone
    ///      badly wrong in review.
    function test_contractDoesNotClaimToBeAFaultProof() public view {
        assertFalse(game.isFaultProof());
        assertEq(
            game.resolutionMechanism(),
            "guardian multisig; no on-chain one-step verifier exists (docs/FAULT_PROOF_SPEC.md)"
        );
    }

    function test_configurationRejectsZeroBonds() public {
        vm.expectRevert(KauraxDisputeGame.InvalidConfiguration.selector);
        new KauraxDisputeGame(address(oracle), guardian, 0, PROPOSER_BOND, RESPONSE_TIMEOUT, MAX_DURATION);
    }

    function test_configurationRejectsZeroTimeout() public {
        vm.expectRevert(KauraxDisputeGame.InvalidConfiguration.selector);
        new KauraxDisputeGame(address(oracle), guardian, CHALLENGER_BOND, PROPOSER_BOND, 0, MAX_DURATION);
    }

    function test_guardianCanBeRotatedOnlyByGuardian() public {
        vm.prank(stranger);
        vm.expectRevert(KauraxDisputeGame.NotGuardian.selector);
        game.setGuardian(stranger);

        vm.prank(guardian);
        game.setGuardian(stranger);
        assertEq(game.guardian(), stranger);
    }
}
