// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {KauraxPortal} from "../src/L2/KauraxPortal.sol";
import {KauraxL2OutputOracle} from "../src/L2/KauraxL2OutputOracle.sol";
import {AddressAliasHelper} from "../src/libraries/AddressAliasHelper.sol";

contract ForcingContract {
    function force(address portal, address to, uint256 value, uint64 gasLimit, bytes calldata data) external {
        KauraxPortal(payable(portal)).forceTransaction(to, value, gasLimit, data);
    }
}

/// @notice The exit hatch, and the incentive that makes it real.
///
/// @dev The property under test is not "a user can submit a forced transaction" — that was
///      always possible via a deposit. It is that ignoring one **costs the sequencer its
///      ability to settle**, which is what turns a request into an obligation.
contract ForcedInclusionTest is Test {
    KauraxPortal internal portal;
    KauraxL2OutputOracle internal oracle;

    address internal proposer = makeAddr("proposer");
    address internal challenger = makeAddr("challenger");
    address internal guardian = makeAddr("guardian");
    address internal sequencer = makeAddr("sequencer");
    address internal alice = makeAddr("alice");

    uint256 internal constant WINDOW = 100;
    uint256 internal constant INTERVAL = 10;
    uint256 internal constant START_BLOCK = 1;

    /// The L3 message passer predeploy — the target of a forced exit.
    address internal constant MESSAGE_PASSER = 0x4200000000000000000000000000000000000016;

    function setUp() public {
        vm.warp(10_000);
        vm.roll(1000);

        oracle = new KauraxL2OutputOracle(
            INTERVAL, 2, START_BLOCK, block.timestamp - 1000, 120, proposer, challenger, 0
        );
        portal = new KauraxPortal(address(oracle), guardian, sequencer, WINDOW);

        vm.prank(challenger);
        oracle.setForcedInclusion(address(portal));

        vm.deal(alice, 100 ether);
    }

    function _propose(uint256 l3Block) internal {
        vm.prank(proposer);
        oracle.proposeL2Output(keccak256(abi.encodePacked("root", l3Block)), l3Block, bytes32(0), 0);
    }

    // ------------------------------------------------------------------ //

    function test_enforcementIsWiredUp() public view {
        assertTrue(oracle.forcedInclusionEnforced(), "oracle is not consulting the portal");
        assertEq(address(oracle.forcedInclusion()), address(portal));
    }

    function test_forcedTransactionIsRecordedWithADeadline() public {
        vm.prank(alice);
        uint256 id = portal.forceTransaction(MESSAGE_PASSER, 5 ether, 100_000, "");

        KauraxPortal.ForcedTransaction memory ft = portal.getForcedTransaction(id);
        assertEq(ft.from, alice);
        assertEq(ft.to, MESSAGE_PASSER);
        assertEq(ft.value, 5 ether);
        assertEq(uint256(ft.deadlineL2Block), block.number + WINDOW);
        assertFalse(ft.acknowledged);
        assertEq(portal.pendingForcedCount(), 1);
    }

    /// A forced transaction is also an ordinary deposit, so the existing derivation
    /// pipeline picks it up with no special casing.
    function test_forcedTransactionAlsoEmitsADeposit() public {
        vm.recordLogs();
        vm.prank(alice);
        portal.forceTransaction(MESSAGE_PASSER, 1 ether, 100_000, "");

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 depositTopic = keccak256("TransactionDeposited(address,address,uint256,bytes)");

        bool sawDeposit;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == depositTopic) sawDeposit = true;
        }
        assertTrue(sawDeposit, "no TransactionDeposited event; derivation would miss it");
        assertEq(portal.depositCount(), 1);
    }

    function test_contractSenderIsAliased() public {
        ForcingContract c = new ForcingContract();
        c.force(address(portal), MESSAGE_PASSER, 1 ether, 100_000, "");

        KauraxPortal.ForcedTransaction memory ft = portal.getForcedTransaction(0);
        assertEq(ft.from, AddressAliasHelper.applyAlias(address(c)), "contract sender not aliased");
    }

    // ------------------------------------------------------- enforcement --

    function test_proposalsSucceedWhileNothingIsOverdue() public {
        vm.prank(alice);
        portal.forceTransaction(MESSAGE_PASSER, 1 ether, 100_000, "");

        // Still inside the window.
        vm.roll(block.number + WINDOW - 1);
        assertFalse(portal.hasOverdueForcedTransactions());
        _propose(START_BLOCK);
        assertEq(oracle.nextOutputIndex(), 1);
    }

    /// The core property: ignoring a forced transaction halts settlement.
    function test_overdueForcedTransactionBlocksProposals() public {
        vm.prank(alice);
        portal.forceTransaction(MESSAGE_PASSER, 1 ether, 100_000, "");

        uint256 deadline = block.number + WINDOW;
        vm.roll(deadline + 1);

        assertTrue(portal.hasOverdueForcedTransactions(), "not reported overdue");

        vm.prank(proposer);
        vm.expectRevert(
            abi.encodeWithSelector(
                KauraxL2OutputOracle.ForcedTransactionOverdue.selector, deadline, block.number
            )
        );
        oracle.proposeL2Output(keccak256("r"), START_BLOCK, bytes32(0), 0);
    }

    function test_acknowledgingUnblocksProposals() public {
        vm.prank(alice);
        uint256 id = portal.forceTransaction(MESSAGE_PASSER, 1 ether, 100_000, "");

        vm.roll(block.number + WINDOW + 1);

        vm.prank(sequencer);
        portal.acknowledgeForcedTransactions(id, 42);

        assertFalse(portal.hasOverdueForcedTransactions());
        assertEq(portal.pendingForcedCount(), 0);

        _propose(START_BLOCK);
        assertEq(oracle.nextOutputIndex(), 1, "proposal still blocked after acknowledgement");
    }

    function test_acknowledgingClearsARangeAtOnce() public {
        vm.startPrank(alice);
        portal.forceTransaction(MESSAGE_PASSER, 1 ether, 100_000, "");
        portal.forceTransaction(MESSAGE_PASSER, 2 ether, 100_000, "");
        uint256 third = portal.forceTransaction(MESSAGE_PASSER, 3 ether, 100_000, "");
        vm.stopPrank();

        assertEq(portal.pendingForcedCount(), 3);

        vm.prank(sequencer);
        portal.acknowledgeForcedTransactions(third, 50);
        assertEq(portal.pendingForcedCount(), 0);
    }

    /// Only the sequencer may claim inclusion — otherwise anyone could clear the backlog
    /// and dissolve the guarantee.
    function test_onlySequencerMayAcknowledge() public {
        vm.prank(alice);
        uint256 id = portal.forceTransaction(MESSAGE_PASSER, 1 ether, 100_000, "");

        vm.prank(alice);
        vm.expectRevert(KauraxPortal.NotSequencer.selector);
        portal.acknowledgeForcedTransactions(id, 1);

        vm.prank(proposer);
        vm.expectRevert(KauraxPortal.NotSequencer.selector);
        portal.acknowledgeForcedTransactions(id, 1);
    }

    function test_cannotAcknowledgeTwice() public {
        vm.prank(alice);
        uint256 id = portal.forceTransaction(MESSAGE_PASSER, 1 ether, 100_000, "");

        vm.startPrank(sequencer);
        portal.acknowledgeForcedTransactions(id, 1);
        vm.expectRevert(KauraxPortal.ForcedAlreadyAcknowledged.selector);
        portal.acknowledgeForcedTransactions(id, 1);
        vm.stopPrank();
    }

    function test_cannotAcknowledgeAnUnknownTransaction() public {
        vm.prank(sequencer);
        vm.expectRevert(KauraxPortal.UnknownForcedTransaction.selector);
        portal.acknowledgeForcedTransactions(0, 1);
    }

    /// The oldest unacknowledged transaction sets the deadline, so a newer one cannot mask
    /// an older overdue one.
    function test_oldestPendingSetsTheDeadline() public {
        vm.prank(alice);
        portal.forceTransaction(MESSAGE_PASSER, 1 ether, 100_000, "");
        uint256 firstDeadline = block.number + WINDOW;

        vm.roll(block.number + 50);
        vm.prank(alice);
        portal.forceTransaction(MESSAGE_PASSER, 2 ether, 100_000, "");

        assertEq(portal.oldestForcedDeadline(), firstDeadline, "newer transaction masked the older deadline");

        vm.roll(firstDeadline + 1);
        assertTrue(portal.hasOverdueForcedTransactions(), "older overdue transaction ignored");
    }

    function test_forcedTransactionRejectsLowGasAndOversizedData() public {
        vm.startPrank(alice);
        vm.expectRevert(KauraxPortal.GasLimitTooLow.selector);
        portal.forceTransaction(MESSAGE_PASSER, 0, 20_999, "");

        bytes memory big = new bytes(120_001);
        vm.expectRevert(KauraxPortal.DataTooLarge.selector);
        portal.forceTransaction(MESSAGE_PASSER, 0, 100_000, big);
        vm.stopPrank();
    }

    function test_pausedPortalRejectsForcedTransactions() public {
        vm.prank(guardian);
        portal.pause();

        vm.prank(alice);
        vm.expectRevert(KauraxPortal.IsPaused.selector);
        portal.forceTransaction(MESSAGE_PASSER, 1 ether, 100_000, "");
    }

    // ------------------------------------------------------- governance --

    function test_guardianCanRotateTheSequencerAndWindow() public {
        address newSequencer = makeAddr("newSequencer");

        vm.startPrank(guardian);
        portal.setSequencer(newSequencer);
        portal.setForcedInclusionWindow(500);
        vm.stopPrank();

        assertEq(portal.sequencer(), newSequencer);
        assertEq(portal.forcedInclusionWindow(), 500);
    }

    function test_strangerCannotRotateTheSequencer() public {
        vm.prank(alice);
        vm.expectRevert(KauraxPortal.NotGuardian.selector);
        portal.setSequencer(alice);
    }

    /// A zero window would make every forced transaction instantly overdue and halt the
    /// chain; an unbounded one would make the guarantee meaningless.
    function test_windowMustBeSane() public {
        vm.startPrank(guardian);
        vm.expectRevert(KauraxPortal.InvalidWindow.selector);
        portal.setForcedInclusionWindow(0);
        vm.expectRevert(KauraxPortal.InvalidWindow.selector);
        portal.setForcedInclusionWindow(200_000);
        vm.stopPrank();
    }

    function test_constructorRejectsAnInsaneWindow() public {
        vm.expectRevert(KauraxPortal.InvalidWindow.selector);
        new KauraxPortal(address(oracle), guardian, sequencer, 0);
    }

    /// Enforcement is opt-in at deployment. An oracle with no portal wired must say so
    /// rather than implying a guarantee it is not providing.
    function test_unwiredOracleReportsEnforcementOff() public {
        KauraxL2OutputOracle bare = new KauraxL2OutputOracle(
            INTERVAL, 2, START_BLOCK, block.timestamp - 1000, 120, proposer, challenger, 0
        );
        assertFalse(bare.forcedInclusionEnforced());

        // And it still accepts proposals, because nothing is being enforced.
        vm.prank(proposer);
        bare.proposeL2Output(keccak256("r"), START_BLOCK, bytes32(0), 0);
        assertEq(bare.nextOutputIndex(), 1);
    }

    function test_onlyChallengerMayWireEnforcement() public {
        KauraxL2OutputOracle bare = new KauraxL2OutputOracle(
            INTERVAL, 2, START_BLOCK, block.timestamp - 1000, 120, proposer, challenger, 0
        );
        vm.prank(alice);
        vm.expectRevert(KauraxL2OutputOracle.NotChallenger.selector);
        bare.setForcedInclusion(address(portal));
    }

    // ------------------------------------------------------------- fuzz --

    /// However many forced transactions are outstanding, the chain settles again exactly
    /// when the sequencer has acknowledged all of them.
    function testFuzz_settlementResumesOnlyAfterFullAcknowledgement(uint8 rawCount) public {
        uint256 count = (uint256(rawCount) % 5) + 1;

        vm.startPrank(alice);
        uint256 last;
        for (uint256 i; i < count; i++) {
            last = portal.forceTransaction(MESSAGE_PASSER, 1 ether, 100_000, "");
        }
        vm.stopPrank();

        vm.roll(block.number + WINDOW + 1);
        assertTrue(portal.hasOverdueForcedTransactions());

        // Acknowledging all but the last must leave settlement blocked.
        if (count > 1) {
            vm.prank(sequencer);
            portal.acknowledgeForcedTransactions(last - 1, 1);
            assertTrue(portal.hasOverdueForcedTransactions(), "settlement resumed too early");
        }

        vm.prank(sequencer);
        portal.acknowledgeForcedTransactions(last, 1);
        assertFalse(portal.hasOverdueForcedTransactions());

        _propose(START_BLOCK);
        assertEq(oracle.nextOutputIndex(), 1);
    }
}
