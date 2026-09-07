// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KauraxMultisig} from "../src/governance/KauraxMultisig.sol";
import {KauraxTimelock} from "../src/governance/KauraxTimelock.sol";
import {KauraxPortal} from "../src/L2/KauraxPortal.sol";
import {KauraxL2OutputOracle} from "../src/L2/KauraxL2OutputOracle.sol";

contract Target {
    uint256 public value;
    bool public shouldRevert;

    function setValue(uint256 v) external {
        if (shouldRevert) revert("target refused");
        value = v;
    }

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    receive() external payable {}
}

contract GovernanceTest is Test {
    KauraxMultisig internal multisig;
    KauraxTimelock internal timelock;
    Target internal target;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal mallory = makeAddr("mallory");
    address internal guardian = makeAddr("guardian");

    uint256 internal constant MIN_DELAY = 1 days;
    uint256 internal constant DELAY = 2 days;

    function setUp() public {
        vm.warp(1_700_000_000);

        address[] memory owners = new address[](3);
        owners[0] = alice;
        owners[1] = bob;
        owners[2] = carol;
        multisig = new KauraxMultisig(owners, 2);

        // Permissionless execution: an operation public for DELAY should not also need the
        // proposer to be available.
        timelock = new KauraxTimelock(MIN_DELAY, DELAY, address(multisig), address(0), guardian);
        target = new Target();

        vm.deal(address(multisig), 100 ether);
        vm.deal(address(timelock), 100 ether);
    }

    // ------------------------------------------------------------------ //
    //                             Multisig                               //
    // ------------------------------------------------------------------ //

    function test_submitConfirmsAutomatically() public {
        vm.prank(alice);
        uint256 id = multisig.submit(address(target), 0, abi.encodeCall(Target.setValue, (42)), "set 42");

        (,,,, uint256 confirmations,,) = multisig.getTransaction(id);
        assertEq(confirmations, 1, "submitter did not auto-confirm");
        assertFalse(multisig.isExecutable(id), "executable below threshold");
    }

    function test_executesAtThreshold() public {
        vm.prank(alice);
        uint256 id = multisig.submit(address(target), 0, abi.encodeCall(Target.setValue, (42)), "set 42");

        vm.prank(bob);
        multisig.confirm(id);
        assertTrue(multisig.isExecutable(id));

        vm.prank(alice);
        multisig.execute(id);
        assertEq(target.value(), 42);
    }

    /// The property the whole contract exists for: one key is not enough.
    function test_oneOwnerCannotExecute() public {
        vm.prank(alice);
        uint256 id = multisig.submit(address(target), 0, abi.encodeCall(Target.setValue, (42)), "");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KauraxMultisig.NotEnoughConfirmations.selector, 1, 2));
        multisig.execute(id);
    }

    function test_nonOwnerCannotSubmitConfirmOrExecute() public {
        vm.prank(alice);
        uint256 id = multisig.submit(address(target), 0, abi.encodeCall(Target.setValue, (1)), "");
        vm.prank(bob);
        multisig.confirm(id);

        vm.startPrank(mallory);
        vm.expectRevert(KauraxMultisig.NotOwner.selector);
        multisig.submit(address(target), 0, "", "");
        vm.expectRevert(KauraxMultisig.NotOwner.selector);
        multisig.confirm(id);
        vm.expectRevert(KauraxMultisig.NotOwner.selector);
        multisig.execute(id);
        vm.stopPrank();
    }

    function test_cannotConfirmTwice() public {
        vm.startPrank(alice);
        uint256 id = multisig.submit(address(target), 0, "", "");
        vm.expectRevert(KauraxMultisig.AlreadyConfirmed.selector);
        multisig.confirm(id);
        vm.stopPrank();
    }

    function test_revokeLowersTheCount() public {
        vm.prank(alice);
        uint256 id = multisig.submit(address(target), 0, abi.encodeCall(Target.setValue, (7)), "");
        vm.prank(bob);
        multisig.confirm(id);
        assertTrue(multisig.isExecutable(id));

        vm.prank(bob);
        multisig.revokeConfirmation(id);
        assertFalse(multisig.isExecutable(id), "still executable after revocation");
    }

    function test_cannotExecuteTwice() public {
        vm.prank(alice);
        uint256 id = multisig.submit(address(target), 0, abi.encodeCall(Target.setValue, (5)), "");
        vm.prank(bob);
        multisig.confirm(id);
        vm.startPrank(alice);
        multisig.execute(id);
        vm.expectRevert(KauraxMultisig.AlreadyExecuted.selector);
        multisig.execute(id);
        vm.stopPrank();
    }

    function test_failedCallRevertsRatherThanMarkingExecuted() public {
        target.setShouldRevert(true);

        vm.prank(alice);
        uint256 id = multisig.submit(address(target), 0, abi.encodeCall(Target.setValue, (1)), "");
        vm.prank(bob);
        multisig.confirm(id);

        vm.prank(alice);
        vm.expectRevert(KauraxMultisig.ExecutionReverted.selector);
        multisig.execute(id);

        // The whole transaction reverted, so the proposal is still executable later.
        (,,, bool executedFlag,,,) = multisig.getTransaction(id);
        assertFalse(executedFlag, "proposal consumed by a failed call");
    }

    function test_canSendValue() public {
        vm.prank(alice);
        uint256 id = multisig.submit(address(target), 5 ether, "", "fund target");
        vm.prank(bob);
        multisig.confirm(id);
        vm.prank(alice);
        multisig.execute(id);
        assertEq(address(target).balance, 5 ether);
    }

    // ---------------------------------------------------- owner changes --

    function test_ownerChangesRequireTheMultisig() public {
        vm.prank(alice);
        vm.expectRevert(KauraxMultisig.NotSelf.selector);
        multisig.addOwner(mallory);
    }

    function test_addOwnerThroughTheMultisig() public {
        address dave = makeAddr("dave");
        vm.prank(alice);
        uint256 id = multisig.submit(
            address(multisig), 0, abi.encodeCall(KauraxMultisig.addOwner, (dave)), "add dave"
        );
        vm.prank(bob);
        multisig.confirm(id);
        vm.prank(alice);
        multisig.execute(id);

        assertTrue(multisig.isOwner(dave));
        assertEq(multisig.ownerCount(), 4);
    }

    /// A proposal confirmed under the old owner set must not survive a membership change —
    /// otherwise a removed owner's signature would still count.
    function test_membershipChangeInvalidatesPendingProposals() public {
        vm.prank(alice);
        uint256 pending = multisig.submit(address(target), 0, abi.encodeCall(Target.setValue, (99)), "later");
        vm.prank(bob);
        multisig.confirm(pending);
        assertTrue(multisig.isExecutable(pending));

        // Now change the owner set.
        address dave = makeAddr("dave");
        vm.prank(alice);
        uint256 change =
            multisig.submit(address(multisig), 0, abi.encodeCall(KauraxMultisig.addOwner, (dave)), "");
        vm.prank(bob);
        multisig.confirm(change);
        vm.prank(alice);
        multisig.execute(change);

        assertFalse(multisig.isExecutable(pending), "stale proposal still executable");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KauraxMultisig.StaleProposal.selector, 0, 1));
        multisig.execute(pending);
    }

    function test_removingOwnerLowersAnUnreachableThreshold() public {
        // 3 owners, threshold 2. Remove two owners: threshold must fall to 1, not brick.
        vm.startPrank(alice);
        uint256 r1 =
            multisig.submit(address(multisig), 0, abi.encodeCall(KauraxMultisig.removeOwner, (carol)), "");
        vm.stopPrank();
        vm.prank(bob);
        multisig.confirm(r1);
        vm.prank(alice);
        multisig.execute(r1);
        assertEq(multisig.ownerCount(), 2);
        assertEq(multisig.threshold(), 2);

        vm.prank(alice);
        uint256 r2 =
            multisig.submit(address(multisig), 0, abi.encodeCall(KauraxMultisig.removeOwner, (bob)), "");
        vm.prank(bob);
        multisig.confirm(r2);
        vm.prank(alice);
        multisig.execute(r2);

        assertEq(multisig.ownerCount(), 1);
        assertEq(multisig.threshold(), 1, "threshold left unreachable");
    }

    function test_cannotRemoveTheLastOwner() public {
        vm.prank(alice);
        uint256 r1 =
            multisig.submit(address(multisig), 0, abi.encodeCall(KauraxMultisig.removeOwner, (carol)), "");
        vm.prank(bob);
        multisig.confirm(r1);
        vm.prank(alice);
        multisig.execute(r1);

        vm.prank(alice);
        uint256 r2 =
            multisig.submit(address(multisig), 0, abi.encodeCall(KauraxMultisig.removeOwner, (bob)), "");
        vm.prank(bob);
        multisig.confirm(r2);
        vm.prank(alice);
        multisig.execute(r2);

        // One owner left, threshold 1.
        vm.prank(alice);
        uint256 r3 =
            multisig.submit(address(multisig), 0, abi.encodeCall(KauraxMultisig.removeOwner, (alice)), "");
        vm.prank(alice);
        vm.expectRevert(KauraxMultisig.ExecutionReverted.selector);
        multisig.execute(r3);
    }

    function test_rejectsInvalidConstruction() public {
        address[] memory owners = new address[](2);
        owners[0] = alice;
        owners[1] = bob;

        vm.expectRevert(abi.encodeWithSelector(KauraxMultisig.InvalidThreshold.selector, 3, 2));
        new KauraxMultisig(owners, 3);

        vm.expectRevert(abi.encodeWithSelector(KauraxMultisig.InvalidThreshold.selector, 0, 2));
        new KauraxMultisig(owners, 0);

        address[] memory dupes = new address[](2);
        dupes[0] = alice;
        dupes[1] = alice;
        vm.expectRevert(KauraxMultisig.AlreadyOwner.selector);
        new KauraxMultisig(dupes, 1);
    }

    // ------------------------------------------------------------------ //
    //                             Timelock                               //
    // ------------------------------------------------------------------ //

    function _schedule(bytes memory data, bytes32 salt) internal returns (uint256 id) {
        vm.prank(alice);
        id = multisig.submit(
            address(timelock),
            0,
            abi.encodeCall(KauraxTimelock.schedule, (address(target), 0, data, salt, "test op")),
            "schedule"
        );
        vm.prank(bob);
        multisig.confirm(id);
        vm.prank(alice);
        multisig.execute(id);
    }

    function test_scheduledOperationCannotRunEarly() public {
        bytes memory data = abi.encodeCall(Target.setValue, (123));
        _schedule(data, bytes32("s1"));

        vm.expectRevert();
        timelock.execute(address(target), 0, data, bytes32("s1"));

        assertEq(target.value(), 0, "operation ran before its delay");
    }

    function test_executesAfterTheDelay() public {
        bytes memory data = abi.encodeCall(Target.setValue, (123));
        _schedule(data, bytes32("s1"));

        vm.warp(block.timestamp + DELAY + 1);
        timelock.execute(address(target), 0, data, bytes32("s1"));
        assertEq(target.value(), 123);
    }

    /// Permissionless execution: a scheduled, publicly visible operation should not depend
    /// on the proposer still being available.
    function test_anyoneMayExecuteOnceReady() public {
        bytes memory data = abi.encodeCall(Target.setValue, (7));
        _schedule(data, bytes32("s1"));
        vm.warp(block.timestamp + DELAY + 1);

        vm.prank(mallory);
        timelock.execute(address(target), 0, data, bytes32("s1"));
        assertEq(target.value(), 7);
    }

    function test_onlyProposerMaySchedule() public {
        vm.prank(mallory);
        vm.expectRevert(KauraxTimelock.NotProposer.selector);
        timelock.schedule(address(target), 0, "", bytes32(0), "");
    }

    function test_guardianMayCancel() public {
        bytes memory data = abi.encodeCall(Target.setValue, (5));
        _schedule(data, bytes32("s1"));

        vm.prank(guardian);
        timelock.cancel(address(target), 0, data, bytes32("s1"));

        vm.warp(block.timestamp + DELAY + 1);
        vm.expectRevert();
        timelock.execute(address(target), 0, data, bytes32("s1"));
    }

    function test_strangerCannotCancel() public {
        bytes memory data = abi.encodeCall(Target.setValue, (5));
        _schedule(data, bytes32("s1"));

        vm.prank(mallory);
        vm.expectRevert(KauraxTimelock.NotProposer.selector);
        timelock.cancel(address(target), 0, data, bytes32("s1"));
    }

    function test_timelockCannotExecuteTwice() public {
        bytes memory data = abi.encodeCall(Target.setValue, (9));
        _schedule(data, bytes32("s1"));
        vm.warp(block.timestamp + DELAY + 1);

        timelock.execute(address(target), 0, data, bytes32("s1"));
        vm.expectRevert();
        timelock.execute(address(target), 0, data, bytes32("s1"));
    }

    function test_stateTransitions() public {
        bytes memory data = abi.encodeCall(Target.setValue, (3));
        bytes32 salt = bytes32("s1");

        assertEq(
            uint256(timelock.stateOf(address(target), 0, data, salt)), uint256(KauraxTimelock.State.Unset)
        );
        _schedule(data, salt);
        assertEq(
            uint256(timelock.stateOf(address(target), 0, data, salt)), uint256(KauraxTimelock.State.Pending)
        );

        vm.warp(block.timestamp + DELAY + 1);
        assertEq(
            uint256(timelock.stateOf(address(target), 0, data, salt)), uint256(KauraxTimelock.State.Ready)
        );

        timelock.execute(address(target), 0, data, salt);
        assertEq(
            uint256(timelock.stateOf(address(target), 0, data, salt)), uint256(KauraxTimelock.State.Done)
        );
    }

    /// The delay cannot be shortened without first waiting out the current delay, so no
    /// change can be rushed through by lowering the wait first.
    function test_delayCannotBeShortenedInstantly() public {
        bytes memory data = abi.encodeCall(KauraxTimelock.setDelay, (MIN_DELAY));

        vm.prank(alice);
        uint256 id = multisig.submit(
            address(timelock),
            0,
            abi.encodeCall(KauraxTimelock.schedule, (address(timelock), 0, data, bytes32("d"), "shorten")),
            ""
        );
        vm.prank(bob);
        multisig.confirm(id);
        vm.prank(alice);
        multisig.execute(id);

        // Still subject to the old delay.
        vm.expectRevert();
        timelock.execute(address(timelock), 0, data, bytes32("d"));

        vm.warp(block.timestamp + DELAY + 1);
        timelock.execute(address(timelock), 0, data, bytes32("d"));
        assertEq(timelock.delay(), MIN_DELAY);
    }

    function test_delayCannotGoBelowTheMinimum() public {
        bytes memory data = abi.encodeCall(KauraxTimelock.setDelay, (1 hours));
        vm.prank(alice);
        uint256 id = multisig.submit(
            address(timelock),
            0,
            abi.encodeCall(KauraxTimelock.schedule, (address(timelock), 0, data, bytes32("d"), "")),
            ""
        );
        vm.prank(bob);
        multisig.confirm(id);
        vm.prank(alice);
        multisig.execute(id);

        vm.warp(block.timestamp + DELAY + 1);
        vm.expectRevert();
        timelock.execute(address(timelock), 0, data, bytes32("d"));
        assertEq(timelock.delay(), DELAY, "minimum delay was bypassed");
    }

    function test_timelockAdminIsSelfOnly() public {
        vm.prank(alice);
        vm.expectRevert(KauraxTimelock.NotSelf.selector);
        timelock.setDelay(MIN_DELAY);

        vm.prank(address(multisig));
        vm.expectRevert(KauraxTimelock.NotSelf.selector);
        timelock.setProposer(mallory);
    }

    // ------------------------------------------------------------------ //
    //                    Governing the real contracts                    //
    // ------------------------------------------------------------------ //

    /// End to end: the portal's guardian is the multisig, so pausing the bridge takes two
    /// signatures instead of one key.
    function test_multisigCanGuardThePortal() public {
        vm.warp(10_000);
        KauraxL2OutputOracle oracle = new KauraxL2OutputOracle(
            10, 2, 1, block.timestamp - 1000, 120, makeAddr("proposer"), address(multisig)
        );
        KauraxPortal portal = new KauraxPortal(address(oracle), address(multisig), makeAddr("sequencer"), 100);

        assertEq(portal.guardian(), address(multisig));

        // A single owner cannot pause.
        vm.prank(alice);
        vm.expectRevert(KauraxPortal.NotGuardian.selector);
        portal.pause();

        // Two can.
        vm.prank(alice);
        uint256 id =
            multisig.submit(address(portal), 0, abi.encodeCall(KauraxPortal.pause, ()), "emergency pause");
        vm.prank(bob);
        multisig.confirm(id);
        vm.prank(alice);
        multisig.execute(id);

        assertTrue(portal.paused(), "multisig could not pause the portal");
    }
}
