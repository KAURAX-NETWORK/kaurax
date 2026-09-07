// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KauraxDisputeGame} from "../src/dispute/KauraxDisputeGame.sol";
import {KauraxL2OutputOracle} from "../src/L2/KauraxL2OutputOracle.sol";

/// @notice A challenger that tries to re-enter the game while being paid its bond.
contract ReentrantChallenger {
    KauraxDisputeGame public immutable GAME;
    uint256 public gameId;
    uint256 public reentryAttempts;
    bool public reentrySucceeded;

    constructor(KauraxDisputeGame _game) payable {
        GAME = _game;
    }

    function open(uint256 outputIndex, address proposer, uint256 bond) external {
        gameId = GAME.challenge{value: bond}(outputIndex, proposer);
    }

    function bisect(bool lower) external {
        GAME.bisect(gameId, lower);
    }

    receive() external payable {
        // Paid on settlement. Try to settle again from inside the transfer.
        reentryAttempts++;
        try GAME.resolveTimeout(gameId) {
            reentrySucceeded = true;
        } catch {
            // Expected: the game is already marked settled before any value moves.
        }
    }
}

/// @notice A proposer whose fallback always reverts, to test that a stuck payout is not
///         silently swallowed.
contract RejectingProposer {
    KauraxDisputeGame public immutable GAME;

    constructor(KauraxDisputeGame _game) payable {
        GAME = _game;
    }

    function defend(uint256 gameId, bytes32 claim, uint256 bond) external {
        GAME.defend{value: bond}(gameId, claim);
    }

    receive() external payable {
        revert("I refuse");
    }
}

contract DisputeGameAdversarialTest is Test {
    KauraxL2OutputOracle internal oracle;
    KauraxDisputeGame internal game;

    address internal proposer = address(0xAAAA);
    address internal guardian = address(0xCCCC);
    address internal attacker = address(0xEEEE);

    uint256 internal constant CHALLENGER_BOND = 1 ether;
    uint256 internal constant PROPOSER_BOND = 2 ether;
    uint64 internal constant RESPONSE_TIMEOUT = 6 hours;
    uint256 internal constant FINALIZATION = 7 days;

    function setUp() public {
        vm.warp(10_000);
        oracle = new KauraxL2OutputOracle(10, 2, 0, block.timestamp - 1000, FINALIZATION, proposer, address(this));
        game = new KauraxDisputeGame(
            address(oracle), guardian, CHALLENGER_BOND, PROPOSER_BOND, RESPONSE_TIMEOUT, 30 days
        );
        oracle.setChallenger(address(game));
        vm.deal(proposer, 100 ether);
        vm.deal(attacker, 100 ether);
        _propose();
        _propose();
    }

    function _propose() internal {
        uint256 next = oracle.nextBlockNumber();
        vm.warp(block.timestamp + 25);
        vm.prank(proposer);
        oracle.proposeL2Output(keccak256(abi.encode(next)), next, bytes32(0), 0);
    }

    // -------------------------------------------------------- reentrancy --

    /// @dev The settled flag is written before any transfer, so a re-entrant call finds the
    ///      game closed. If this ever fails, a winner can drain the contract.
    function test_reentrantWinnerCannotSettleTwice() public {
        ReentrantChallenger evil = new ReentrantChallenger{value: 10 ether}(game);
        evil.open(1, proposer, CHALLENGER_BOND);

        vm.warp(block.timestamp + RESPONSE_TIMEOUT + 1);
        game.resolveTimeout(evil.gameId());

        assertGt(evil.reentryAttempts(), 0, "the fallback must actually have run");
        assertFalse(evil.reentrySucceeded(), "re-entry must not settle a second time");
        assertEq(address(game).balance, 0, "no funds may remain");
        assertEq(address(evil).balance, 10 ether, "exactly its own bond back, nothing more");
    }

    /// @dev A payout that cannot be delivered must revert rather than be swallowed, or the
    ///      contract quietly keeps someone's money.
    function test_failedPayoutRevertsRatherThanStrandingFunds() public {
        RejectingProposer stubborn = new RejectingProposer{value: 10 ether}(game);

        vm.prank(attacker);
        uint256 id = game.challenge{value: CHALLENGER_BOND}(1, address(stubborn));
        stubborn.defend(id, keccak256("claim"), PROPOSER_BOND);

        // Challenger walks away; the proposer should win, but cannot receive.
        vm.warp(block.timestamp + RESPONSE_TIMEOUT + 1);
        vm.expectRevert(KauraxDisputeGame.TransferFailed.selector);
        game.resolveTimeout(id);
    }

    // ----------------------------------------------------------- griefing --

    /// @dev One bond must not be able to tie up a proposer in parallel games.
    function test_cannotOpenParallelGamesOnOneOutput() public {
        vm.prank(attacker);
        uint256 first = game.challenge{value: CHALLENGER_BOND}(1, proposer);

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(KauraxDisputeGame.GameAlreadyLive.selector, first));
        game.challenge{value: CHALLENGER_BOND}(1, proposer);
    }

    /// @dev After a game closes the slot must free, or an output can never be disputed again.
    function test_slotIsReleasedAfterSettlement() public {
        vm.prank(attacker);
        uint256 id = game.challenge{value: CHALLENGER_BOND}(1, proposer);
        vm.warp(block.timestamp + RESPONSE_TIMEOUT + 1);
        game.resolveTimeout(id);

        (bool exists,) = game.liveGame(1);
        assertFalse(exists, "slot must be released");
    }

    /// @dev The caller of resolveTimeout must not influence who wins.
    function test_timeoutWinnerDoesNotDependOnCaller() public {
        vm.prank(attacker);
        uint256 id = game.challenge{value: CHALLENGER_BOND}(1, proposer);
        vm.prank(proposer);
        game.defend{value: PROPOSER_BOND}(id, keccak256("claim"));

        uint256 before = proposer.balance;
        vm.warp(block.timestamp + RESPONSE_TIMEOUT + 1);
        // The attacker calls it, and still loses: the challenger's turn had lapsed.
        vm.prank(attacker);
        game.resolveTimeout(id);

        assertEq(proposer.balance, before + CHALLENGER_BOND + PROPOSER_BOND);
    }

    // ------------------------------------------------------ authorisation --

    function test_guardianCannotResolveAnUnnarrowedGame() public {
        vm.prank(attacker);
        uint256 id = game.challenge{value: CHALLENGER_BOND}(1, proposer);
        vm.prank(guardian);
        vm.expectRevert(KauraxDisputeGame.NotNarrowed.selector);
        game.resolve(id, true, "skipping the game");
    }

    function test_guardianCannotDeleteOutputsDirectly() public {
        // The oracle's challenger is the dispute game, so even the guardian has no path to
        // deleteL2Outputs except through a resolved dispute.
        vm.prank(guardian);
        vm.expectRevert();
        oracle.deleteL2Outputs(1);
    }

    function test_strangerCannotResolve() public {
        vm.prank(attacker);
        vm.expectRevert(KauraxDisputeGame.NotGuardian.selector);
        game.resolve(0, true, "");
    }

    // ------------------------------------------------------------- replay --

    function test_unknownGameReverts() public {
        vm.expectRevert(KauraxDisputeGame.UnknownGame.selector);
        game.getGame(999);
    }

    function test_movesOnSettledGameRevert() public {
        vm.prank(attacker);
        uint256 id = game.challenge{value: CHALLENGER_BOND}(1, proposer);
        vm.warp(block.timestamp + RESPONSE_TIMEOUT + 1);
        game.resolveTimeout(id);

        vm.prank(proposer);
        vm.expectRevert();
        game.defend{value: PROPOSER_BOND}(id, keccak256("late"));
    }

    // ------------------------------------------------- economic soundness --

    /// @dev Across an arbitrary sequence of games, the contract must never end holding
    ///      value and never pay out more than was staked.
    function testFuzz_bondsConserved(uint8 rounds) public {
        uint256 n = uint256(rounds) % 5 + 1;
        uint256 staked;
        uint256 startBalance = attacker.balance + proposer.balance;

        for (uint256 i = 0; i < n; i++) {
            _propose();
            uint256 idx = oracle.nextOutputIndex() - 1;

            vm.prank(attacker);
            uint256 id = game.challenge{value: CHALLENGER_BOND}(idx, proposer);
            staked += CHALLENGER_BOND;

            vm.warp(block.timestamp + RESPONSE_TIMEOUT + 1);
            game.resolveTimeout(id);
        }

        assertEq(address(game).balance, 0, "contract must hold nothing");
        assertEq(attacker.balance + proposer.balance, startBalance, "no value created or destroyed");
        assertGt(staked, 0);
    }
}
