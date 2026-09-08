// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KauraxTimelock} from "../src/governance/KauraxTimelock.sol";

/// @notice The timelock's self-administration path.
///
/// @dev This is how the timelock's own parameters change — its delay, its proposer, its
///      executor, its guardian — and it was the least covered code in a contract the CI
///      coverage gate calls security-critical. It is also the most dangerous: a delay that
///      could be shortened without waiting out the current delay would let a captured
///      proposer rush anything through, so `setDelay` being reachable only through a
///      scheduled operation is the property that makes every other delay meaningful.
contract TimelockSelfAdminTest is Test {
    KauraxTimelock internal timelock;

    address internal proposer = address(0xF0);
    address internal guardian = address(0x6A);
    address internal stranger = address(0x5B);

    uint256 internal constant MIN_DELAY = 1 hours;
    uint256 internal constant DELAY = 2 hours;

    function setUp() public {
        // Permissionless execution: an operation that has been public for DELAY should not
        // also depend on the proposer being available to run it.
        timelock = new KauraxTimelock(MIN_DELAY, DELAY, proposer, address(0), guardian);
    }

    // ------------------------------------------------------------ the guard --

    /// @notice Every setter is reachable only by the timelock calling itself.
    function test_selfAdminFunctionsRejectEveryDirectCaller() public {
        address[3] memory callers = [proposer, guardian, stranger];
        for (uint256 i = 0; i < callers.length; i++) {
            vm.startPrank(callers[i]);
            vm.expectRevert(KauraxTimelock.NotSelf.selector);
            timelock.setDelay(MIN_DELAY);
            vm.expectRevert(KauraxTimelock.NotSelf.selector);
            timelock.setProposer(stranger);
            vm.expectRevert(KauraxTimelock.NotSelf.selector);
            timelock.setExecutor(stranger);
            vm.expectRevert(KauraxTimelock.NotSelf.selector);
            timelock.setGuardian(stranger);
            vm.stopPrank();
        }
    }

    // ------------------------------------------------- changes that succeed --

    function test_delayIsChangedThroughTheTimelockItself() public {
        uint256 newDelay = 3 hours;
        _scheduleAndExecute(abi.encodeCall(KauraxTimelock.setDelay, (newDelay)), "delay");
        assertEq(timelock.delay(), newDelay);
    }

    function test_proposerIsChangedThroughTheTimelockItself() public {
        _scheduleAndExecute(abi.encodeCall(KauraxTimelock.setProposer, (stranger)), "proposer");
        assertEq(timelock.proposer(), stranger);
    }

    function test_executorIsChangedThroughTheTimelockItself() public {
        _scheduleAndExecute(abi.encodeCall(KauraxTimelock.setExecutor, (stranger)), "executor");
        assertEq(timelock.executor(), stranger);
    }

    function test_guardianIsChangedThroughTheTimelockItself() public {
        _scheduleAndExecute(abi.encodeCall(KauraxTimelock.setGuardian, (stranger)), "guardian");
        assertEq(timelock.guardian(), stranger);
    }

    /// @notice Setting an executor restricts execution; clearing it opens execution again.
    ///
    /// @dev Unlike the proposer, address(0) is a legitimate value here — it is what makes
    ///      execution permissionless. The middle of this test is the part worth having: once
    ///      an executor is named, nobody else can execute, including whoever scheduled the
    ///      operation. An earlier version of this test missed that and failed with
    ///      NotExecutor, which was the contract being right.
    function test_settingAnExecutorRestrictsExecutionAndClearingItOpensAgain() public {
        _scheduleAndExecute(abi.encodeCall(KauraxTimelock.setExecutor, (stranger)), "set");
        assertEq(timelock.executor(), stranger);

        bytes memory clear = abi.encodeCall(KauraxTimelock.setExecutor, (address(0)));
        vm.prank(proposer);
        timelock.schedule(address(timelock), 0, clear, bytes32("clear"), "self-administration test");
        vm.warp(block.timestamp + DELAY);

        // Anyone else is now refused, even though the operation is ready.
        vm.expectRevert(KauraxTimelock.NotExecutor.selector);
        timelock.execute(address(timelock), 0, clear, bytes32("clear"));

        vm.prank(stranger);
        timelock.execute(address(timelock), 0, clear, bytes32("clear"));
        assertEq(timelock.executor(), address(0), "execution is permissionless again");
    }

    // -------------------------------------------------- changes that cannot --

    /// @notice The delay cannot go below the immutable floor set at construction.
    function test_delayCannotBeSetBelowTheMinimum() public {
        bytes memory data = abi.encodeCall(KauraxTimelock.setDelay, (MIN_DELAY - 1));
        vm.prank(proposer);
        timelock.schedule(address(timelock), 0, data, bytes32("floor"), "self-administration test");
        vm.warp(block.timestamp + DELAY);

        // The revert surfaces through execute, because the timelock is calling itself.
        vm.expectRevert();
        timelock.execute(address(timelock), 0, data, bytes32("floor"));
        assertEq(timelock.delay(), DELAY, "delay must be unchanged after a failed change");
    }

    function test_proposerCannotBeSetToZero() public {
        bytes memory data = abi.encodeCall(KauraxTimelock.setProposer, (address(0)));
        vm.prank(proposer);
        timelock.schedule(address(timelock), 0, data, bytes32("zero"), "self-administration test");
        vm.warp(block.timestamp + DELAY);

        vm.expectRevert();
        timelock.execute(address(timelock), 0, data, bytes32("zero"));
        assertEq(timelock.proposer(), proposer, "proposer must be unchanged");
    }

    /// @notice Shortening the delay still costs the *current* delay.
    /// @dev Otherwise the first thing a captured proposer would do is set the delay to its
    ///      minimum and then move freely — the timelock would protect nothing but itself,
    ///      once.
    function test_shorteningTheDelayCannotBeRushed() public {
        bytes memory data = abi.encodeCall(KauraxTimelock.setDelay, (MIN_DELAY));
        vm.prank(proposer);
        timelock.schedule(address(timelock), 0, data, bytes32("shorten"), "self-administration test");

        // One second short of the current delay: still refused.
        vm.warp(block.timestamp + DELAY - 1);
        vm.expectRevert();
        timelock.execute(address(timelock), 0, data, bytes32("shorten"));

        vm.warp(block.timestamp + 1);
        timelock.execute(address(timelock), 0, data, bytes32("shorten"));
        assertEq(timelock.delay(), MIN_DELAY);
    }

    // ------------------------------------------------------------- lifecycle --

    function test_guardianCanCancelAScheduledOperation() public {
        bytes memory data = abi.encodeCall(KauraxTimelock.setGuardian, (stranger));
        vm.prank(proposer);
        bytes32 id =
            timelock.schedule(address(timelock), 0, data, bytes32("cancel"), "self-administration test");

        vm.prank(guardian);
        timelock.cancel(address(timelock), 0, data, bytes32("cancel"));
        assertEq(timelock.readyAt(id), 0, "cancelling clears the schedule");

        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(abi.encodeWithSelector(KauraxTimelock.NotScheduled.selector, id));
        timelock.execute(address(timelock), 0, data, bytes32("cancel"));
    }

    function test_strangersCannotCancel() public {
        bytes memory data = abi.encodeCall(KauraxTimelock.setGuardian, (stranger));
        vm.prank(proposer);
        timelock.schedule(address(timelock), 0, data, bytes32("nope"), "self-administration test");

        vm.prank(stranger);
        vm.expectRevert(KauraxTimelock.NotProposer.selector);
        timelock.cancel(address(timelock), 0, data, bytes32("nope"));
    }

    function test_theSameOperationCannotBeScheduledTwice() public {
        bytes memory data = abi.encodeCall(KauraxTimelock.setGuardian, (stranger));
        vm.startPrank(proposer);
        bytes32 id = timelock.schedule(address(timelock), 0, data, bytes32("dup"), "self-administration test");
        vm.expectRevert(abi.encodeWithSelector(KauraxTimelock.AlreadyScheduled.selector, id));
        timelock.schedule(address(timelock), 0, data, bytes32("dup"), "self-administration test");
        vm.stopPrank();
    }

    /// @dev The salt is what lets the same call be scheduled twice on purpose.
    function test_theSaltDistinguishesOtherwiseIdenticalOperations() public {
        bytes memory data = abi.encodeCall(KauraxTimelock.setGuardian, (stranger));
        vm.startPrank(proposer);
        bytes32 a = timelock.schedule(address(timelock), 0, data, bytes32("one"), "self-administration test");
        bytes32 b = timelock.schedule(address(timelock), 0, data, bytes32("two"), "self-administration test");
        vm.stopPrank();
        assertTrue(a != b, "different salts must give different operations");
    }

    function test_schedulingTheZeroAddressIsRefused() public {
        vm.prank(proposer);
        vm.expectRevert(KauraxTimelock.ZeroAddress.selector);
        timelock.schedule(address(0), 0, "", bytes32("zero"), "self-administration test");
    }

    function test_onlyTheProposerMaySchedule() public {
        vm.prank(stranger);
        vm.expectRevert(KauraxTimelock.NotProposer.selector);
        timelock.schedule(address(timelock), 0, "", bytes32("x"), "self-administration test");
    }

    // ----------------------------------------------------------------- fuzz --

    /// @notice Any delay at or above the floor is accepted; anything below is refused.
    function testFuzz_delayFloorHolds(uint64 _newDelay) public {
        bytes memory data = abi.encodeCall(KauraxTimelock.setDelay, (uint256(_newDelay)));
        vm.prank(proposer);
        timelock.schedule(address(timelock), 0, data, bytes32("fuzz"), "self-administration test");
        vm.warp(block.timestamp + DELAY);

        if (_newDelay < MIN_DELAY) {
            vm.expectRevert();
            timelock.execute(address(timelock), 0, data, bytes32("fuzz"));
            assertEq(timelock.delay(), DELAY);
        } else {
            timelock.execute(address(timelock), 0, data, bytes32("fuzz"));
            assertEq(timelock.delay(), uint256(_newDelay));
        }
    }

    // -------------------------------------------------------------- helpers --

    function _scheduleAndExecute(bytes memory _data, bytes32 _salt) internal {
        vm.prank(proposer);
        timelock.schedule(address(timelock), 0, _data, _salt, "self-administration test");
        vm.warp(block.timestamp + DELAY);
        timelock.execute(address(timelock), 0, _data, _salt);
    }
}
