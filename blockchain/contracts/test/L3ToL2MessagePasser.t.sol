// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {L3ToL2MessagePasser} from "../src/L3/L3ToL2MessagePasser.sol";
import {Hashing} from "../src/libraries/Hashing.sol";
import {Types} from "../src/libraries/Types.sol";

/// @notice Every KAURAX withdrawal starts here. The leaf this contract inserts is what the
///         proposer commits to and what `KauraxPortal` proves against on the L2, so a
///         withdrawal that is not recorded here is unprovable, and value burned without a
///         matching leaf is lost.
contract L3ToL2MessagePasserTest is Test {
    L3ToL2MessagePasser internal passer;

    address internal alice = makeAddr("alice");
    address internal target = makeAddr("target");

    uint256 internal constant MIN_GAS = 21_000;

    function setUp() public {
        passer = new L3ToL2MessagePasser();
        vm.deal(alice, 100 ether);
    }

    function _hash(uint256 nonce, address sender, uint256 value, bytes memory data)
        internal
        view
        returns (bytes32)
    {
        return Hashing.hashWithdrawal(
            Types.WithdrawalTransaction({
                nonce: nonce, sender: sender, target: target, value: value, gasLimit: MIN_GAS, data: data
            })
        );
    }

    // ------------------------------------------------------------------------ validation --

    function test_gasLimitBelowTheFloorIsRejected() public {
        vm.prank(alice);
        vm.expectRevert(L3ToL2MessagePasser.GasLimitTooLow.selector);
        passer.initiateWithdrawal(target, MIN_GAS - 1, hex"");
    }

    function test_gasLimitAtTheFloorIsAccepted() public {
        vm.prank(alice);
        passer.initiateWithdrawal(target, MIN_GAS, hex"");
        assertEq(passer.withdrawalCount(), 1);
    }

    /// The cap bounds what the L2 must be willing to accept as calldata when finalizing.
    function test_oversizedDataIsRejected() public {
        bytes memory big = new bytes(120_001);
        vm.prank(alice);
        vm.expectRevert(L3ToL2MessagePasser.DataTooLarge.selector);
        passer.initiateWithdrawal(target, MIN_GAS, big);
    }

    function test_dataAtTheCapIsAccepted() public {
        bytes memory atCap = new bytes(120_000);
        vm.prank(alice);
        passer.initiateWithdrawal(target, MIN_GAS, atCap);
        assertEq(passer.withdrawalCount(), 1);
    }

    // -------------------------------------------------------------------------- recording --

    function test_withdrawalIsRecordedAndProvable() public {
        vm.prank(alice);
        passer.initiateWithdrawal(target, MIN_GAS, hex"");

        bytes32 h = _hash(0, alice, 0, hex"");
        assertTrue(passer.sentMessages(h), "withdrawal not recorded");
        assertEq(passer.leafIndexOf(h), 0);
        assertEq(passer.withdrawalCount(), 1);
    }

    function test_nonceIncrementsPerWithdrawalSoIdenticalCallsAreDistinct() public {
        vm.startPrank(alice);
        passer.initiateWithdrawal(target, MIN_GAS, hex"");
        passer.initiateWithdrawal(target, MIN_GAS, hex"");
        vm.stopPrank();

        assertEq(passer.messageNonce(), 2);
        assertEq(passer.withdrawalCount(), 2);
        assertEq(passer.leafIndexOf(_hash(0, alice, 0, hex"")), 0);
        assertEq(passer.leafIndexOf(_hash(1, alice, 0, hex"")), 1, "identical calls must not collide");
    }

    function test_unknownWithdrawalIsNotSilentlyIndexZero() public {
        assertFalse(passer.sentMessages(bytes32(uint256(0xdead))));
        vm.expectRevert("L3ToL2MessagePasser: unknown withdrawal");
        passer.leafIndexOf(bytes32(uint256(0xdead)));
    }

    function test_treeRootChangesWithEachWithdrawal() public {
        bytes32 empty = passer.withdrawalTreeRoot();

        vm.prank(alice);
        passer.initiateWithdrawal(target, MIN_GAS, hex"");
        bytes32 one = passer.withdrawalTreeRoot();
        assertTrue(one != empty, "root did not move on the first withdrawal");

        vm.prank(alice);
        passer.initiateWithdrawal(target, MIN_GAS, hex"01");
        assertTrue(passer.withdrawalTreeRoot() != one, "root did not move on the second");
    }

    // ------------------------------------------------------------------------------ value --

    /// Value leaving KAURAX must actually be destroyed here. If it stayed on this contract
    /// the same KAX would exist on both sides of the bridge once the withdrawal finalized.
    function test_valueIsBurnedAndAccounted() public {
        vm.prank(alice);
        passer.initiateWithdrawal{value: 3 ether}(target, MIN_GAS, hex"");

        assertEq(address(passer).balance, 0, "value must not remain on the passer");
        assertEq(passer.totalBurned(), 3 ether);
        assertTrue(passer.sentMessages(_hash(0, alice, 3 ether, hex"")));
    }

    function test_zeroValueWithdrawalBurnsNothing() public {
        vm.prank(alice);
        passer.initiateWithdrawal(target, MIN_GAS, hex"");
        assertEq(passer.totalBurned(), 0);
        assertEq(address(passer).balance, 0);
    }

    function testFuzz_totalBurnedTracksEveryWithdrawal(uint96 a, uint96 b) public {
        vm.deal(alice, uint256(a) + uint256(b));

        vm.startPrank(alice);
        passer.initiateWithdrawal{value: a}(target, MIN_GAS, hex"");
        passer.initiateWithdrawal{value: b}(target, MIN_GAS, hex"");
        vm.stopPrank();

        assertEq(passer.totalBurned(), uint256(a) + uint256(b));
        assertEq(address(passer).balance, 0);
    }
}
