// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KVSMerkle} from "../src/kvs/KVSMerkle.sol";
import {KVSTypes} from "../src/kvs/KVSTypes.sol";

/// @notice The commitment primitive the one-step verifier rests on.
/// @dev Everything the verifier can prove reduces to `computeRoot` being hard to lie to,
///      so this suite spends its effort on the ways a prover would try.
contract KVSMerkleTest is Test {
    function test_zeroRootIsTheZeroChain() public pure {
        assertEq(KVSMerkle.zeroRoot(0), bytes32(0));
        assertEq(KVSMerkle.zeroRoot(1), keccak256(abi.encodePacked(bytes32(0), bytes32(0))));
        assertEq(
            KVSMerkle.zeroRoot(2), keccak256(abi.encodePacked(KVSMerkle.zeroRoot(1), KVSMerkle.zeroRoot(1)))
        );
    }

    /// @dev If two heights shared a zero root, a proof at one depth would verify at another
    ///      and the stack, memory and storage commitments would stop being distinct.
    function test_everyHeightHasItsOwnZeroRoot() public pure {
        assertTrue(KVSMerkle.zeroRoot(KVSTypes.STACK_HEIGHT) != KVSMerkle.zeroRoot(KVSTypes.MEMORY_HEIGHT));
        assertTrue(KVSMerkle.zeroRoot(KVSTypes.MEMORY_HEIGHT) != KVSMerkle.zeroRoot(KVSTypes.STORAGE_HEIGHT));
        assertTrue(KVSMerkle.zeroRoot(KVSTypes.STACK_HEIGHT) != KVSMerkle.zeroRoot(KVSTypes.STORAGE_HEIGHT));
    }

    function test_emptyTreeProvesAbsence() public pure {
        bytes32[] memory siblings = _zeroSiblings(KVSTypes.STACK_HEIGHT);
        assertEq(KVSMerkle.computeRoot(bytes32(0), 7, siblings), KVSMerkle.zeroRoot(KVSTypes.STACK_HEIGHT));
    }

    /// @dev Without the range check the fold would silently ignore an index's high bits,
    ///      letting one proof place the same leaf at many positions.
    function test_indexBeyondTheHeightIsRejected() public {
        bytes32[] memory siblings = _zeroSiblings(4);
        vm.expectRevert(abi.encodeWithSelector(KVSMerkle.IndexOutOfRange.selector, uint256(16), uint256(4)));
        this.computeRoot(bytes32(uint256(1)), 16, siblings);
    }

    function test_fullDepthStorageIndicesAreAlwaysInRange() public view {
        bytes32[] memory siblings = _zeroSiblings(KVSTypes.STORAGE_HEIGHT);
        // No revert: at height 256 every uint256 addresses a real leaf.
        this.computeRoot(bytes32(0), type(uint256).max, siblings);
    }

    function test_updateRefusesAnUnprovenPriorValue() public {
        bytes32[] memory siblings = _zeroSiblings(KVSTypes.STACK_HEIGHT);
        bytes32 root = KVSMerkle.zeroRoot(KVSTypes.STACK_HEIGHT);
        // Claiming the slot held something it did not is exactly the lie the verifier has
        // to refuse, since that is how a prover would fabricate an operand.
        vm.expectRevert();
        this.update(root, 3, keccak256("never stored"), keccak256("new"), siblings);
    }

    function test_updateReturnsTheRootThatVerifiesTheNewLeaf() public view {
        bytes32[] memory siblings = _zeroSiblings(KVSTypes.STACK_HEIGHT);
        bytes32 root = KVSMerkle.zeroRoot(KVSTypes.STACK_HEIGHT);
        bytes32 leaf = keccak256("value");

        bytes32 newRoot = this.update(root, 3, bytes32(0), leaf, siblings);
        assertEq(this.computeRoot(leaf, 3, siblings), newRoot);
    }

    function testFuzz_writingThenClearingRestoresTheRoot(uint16 _index, bytes32 _leaf) public view {
        uint256 idx = uint256(_index) % (1 << KVSTypes.STACK_HEIGHT);
        bytes32[] memory siblings = _zeroSiblings(KVSTypes.STACK_HEIGHT);
        bytes32 root = KVSMerkle.zeroRoot(KVSTypes.STACK_HEIGHT);

        bytes32 written = this.update(root, idx, bytes32(0), _leaf, siblings);
        bytes32 cleared = this.update(written, idx, _leaf, bytes32(0), siblings);
        assertEq(cleared, root);
    }

    function testFuzz_differentLeavesGiveDifferentRoots(bytes32 _a, bytes32 _b) public view {
        vm.assume(_a != _b);
        bytes32[] memory siblings = _zeroSiblings(KVSTypes.STACK_HEIGHT);
        assertTrue(this.computeRoot(_a, 1, siblings) != this.computeRoot(_b, 1, siblings));
    }

    function testFuzz_theSameLeafAtDifferentIndicesGivesDifferentRoots(bytes32 _leaf, uint8 _i, uint8 _j)
        public
        view
    {
        vm.assume(_i != _j);
        vm.assume(_leaf != bytes32(0));
        bytes32[] memory siblings = _zeroSiblings(KVSTypes.STACK_HEIGHT);
        assertTrue(this.computeRoot(_leaf, _i, siblings) != this.computeRoot(_leaf, _j, siblings));
    }

    // --------------------------------------------------------------------- gas --

    /// @notice Records what a storage proof costs, since it is the largest single component
    ///         of a step proof and the number a reviewer will want.
    function test_storageProofGasIsRecorded() public view {
        bytes32[] memory siblings = _zeroSiblings(KVSTypes.STORAGE_HEIGHT);
        uint256 before = gasleft();
        KVSMerkle.computeRoot(keccak256("v"), uint256(keccak256("slot")), siblings);
        uint256 used = before - gasleft();
        // Not a performance assertion — a canary. A full-depth fold is ~256 keccaks, and an
        // order-of-magnitude change means the structure changed underneath the verifier.
        assertLt(used, 500_000, "a full-depth storage fold should stay well inside the budget");
    }

    // ----------------------------------------------------------------- helpers --

    /// @dev External wrappers so `vm.expectRevert` sees a call boundary; a library reverting
    ///      inline would abort the test rather than be caught.
    function computeRoot(bytes32 _leaf, uint256 _index, bytes32[] memory _siblings)
        external
        pure
        returns (bytes32)
    {
        return KVSMerkle.computeRoot(_leaf, _index, _siblings);
    }

    function update(bytes32 _root, uint256 _index, bytes32 _old, bytes32 _new, bytes32[] memory _siblings)
        external
        pure
        returns (bytes32)
    {
        return KVSMerkle.update(_root, _index, _old, _new, _siblings);
    }

    function _zeroSiblings(uint256 _height) internal pure returns (bytes32[] memory out) {
        out = new bytes32[](_height);
        for (uint256 i = 0; i < _height; i++) {
            out[i] = KVSMerkle.zeroRoot(i);
        }
    }
}
