// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MerkleTree} from "../src/libraries/MerkleTree.sol";
import {MerkleHelper} from "./helpers/MerkleHelper.sol";

/// @dev Wrapper so the storage-based library can be exercised from tests.
contract TreeHarness {
    using MerkleTree for MerkleTree.Tree;

    MerkleTree.Tree internal _tree;

    function insert(bytes32 leaf) external returns (uint256) {
        return _tree.insert(leaf);
    }

    function root() external view returns (bytes32) {
        return _tree.root();
    }

    function count() external view returns (uint256) {
        return _tree.count;
    }

    /// @dev External wrapper so revert expectations work against a real call frame.
    function verify(bytes32 root_, bytes32 leaf, uint256 index, bytes32[] calldata proof)
        external
        pure
        returns (bool)
    {
        return MerkleTree.verify(root_, leaf, index, proof);
    }
}

contract MerkleTreeTest is Test {
    TreeHarness internal tree;

    function setUp() public {
        tree = new TreeHarness();
    }

    function test_emptyRootMatchesZeroChain() public view {
        assertEq(tree.root(), MerkleHelper.zeroHash(MerkleTree.TREE_DEPTH));
    }

    /// The incremental on-chain root must equal the root recomputed from all leaves.
    /// This is the invariant the whole withdrawal proof depends on.
    function test_incrementalRootMatchesFullRebuild() public {
        bytes32[] memory leaves = new bytes32[](7);
        for (uint256 i = 0; i < 7; i++) {
            leaves[i] = keccak256(abi.encodePacked("withdrawal", i));
            tree.insert(leaves[i]);

            bytes32[] memory sofar = new bytes32[](i + 1);
            for (uint256 j = 0; j <= i; j++) {
                sofar[j] = leaves[j];
            }
            assertEq(tree.root(), MerkleHelper.root(sofar), "incremental root diverged");
        }
    }

    function test_proofVerifiesForEveryLeaf() public {
        uint256 n = 9;
        bytes32[] memory leaves = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            leaves[i] = keccak256(abi.encodePacked("w", i));
            tree.insert(leaves[i]);
        }
        bytes32 r = tree.root();

        for (uint256 i = 0; i < n; i++) {
            bytes32[] memory p = MerkleHelper.proof(leaves, i);
            assertTrue(MerkleTree.verify(r, leaves[i], i, p), "valid proof rejected");
        }
    }

    function test_rejectsWrongLeaf() public {
        bytes32[] memory leaves = new bytes32[](4);
        for (uint256 i = 0; i < 4; i++) {
            leaves[i] = keccak256(abi.encodePacked("w", i));
            tree.insert(leaves[i]);
        }
        bytes32 r = tree.root();
        bytes32[] memory p = MerkleHelper.proof(leaves, 2);

        assertFalse(MerkleTree.verify(r, keccak256("forged"), 2, p), "forged leaf accepted");
    }

    function test_rejectsWrongIndex() public {
        bytes32[] memory leaves = new bytes32[](4);
        for (uint256 i = 0; i < 4; i++) {
            leaves[i] = keccak256(abi.encodePacked("w", i));
            tree.insert(leaves[i]);
        }
        bytes32 r = tree.root();
        bytes32[] memory p = MerkleHelper.proof(leaves, 1);

        assertFalse(MerkleTree.verify(r, leaves[1], 3, p), "proof accepted at wrong index");
    }

    function test_revertsOnShortProof() public {
        bytes32[] memory short_ = new bytes32[](4);
        vm.expectRevert(MerkleTree.InvalidProofLength.selector);
        tree.verify(bytes32(uint256(1)), bytes32(uint256(2)), 0, short_);
    }

    function testFuzz_incrementalMatchesRebuild(uint8 rawCount, bytes32 seed) public {
        uint256 n = uint256(rawCount) % 24;
        bytes32[] memory leaves = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            leaves[i] = keccak256(abi.encodePacked(seed, i));
            tree.insert(leaves[i]);
        }
        assertEq(tree.root(), MerkleHelper.root(leaves));
        assertEq(tree.count(), n);
    }

    function testFuzz_proofRoundTrip(uint8 rawCount, uint8 rawIndex, bytes32 seed) public {
        uint256 n = (uint256(rawCount) % 20) + 1;
        uint256 idx = uint256(rawIndex) % n;

        bytes32[] memory leaves = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            leaves[i] = keccak256(abi.encodePacked(seed, i));
            tree.insert(leaves[i]);
        }
        bytes32[] memory p = MerkleHelper.proof(leaves, idx);
        assertTrue(MerkleTree.verify(tree.root(), leaves[idx], idx, p));
    }
}
