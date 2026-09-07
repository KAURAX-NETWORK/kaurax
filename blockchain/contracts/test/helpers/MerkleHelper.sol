// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MerkleTree} from "../../src/libraries/MerkleTree.sol";

/// @notice Reference off-chain-style proof builder, used by tests. It rebuilds the whole
///         tree from the leaf set, which is exactly what `packages/node` does from
///         MessagePassed events. If this and MerkleTree.sol ever disagree, one of them is
///         wrong — which is the point of comparing them.
library MerkleHelper {
    function zeroHash(uint256 height) internal pure returns (bytes32 h) {
        h = bytes32(0);
        for (uint256 i = 0; i < height; i++) {
            h = keccak256(abi.encodePacked(h, h));
        }
    }

    /// @notice Build the sibling path for `index` given the full leaf set.
    function proof(bytes32[] memory leaves, uint256 index) internal pure returns (bytes32[] memory) {
        bytes32[] memory path = new bytes32[](MerkleTree.TREE_DEPTH);
        bytes32[] memory level = leaves;
        uint256 idx = index;

        for (uint256 height = 0; height < MerkleTree.TREE_DEPTH; height++) {
            uint256 sibling = idx ^ 1;
            path[height] = sibling < level.length ? level[sibling] : zeroHash(height);

            uint256 nextLen = (level.length + 1) / 2;
            bytes32[] memory next = new bytes32[](nextLen);
            for (uint256 i = 0; i < nextLen; i++) {
                bytes32 left = level[2 * i];
                bytes32 right = (2 * i + 1) < level.length ? level[2 * i + 1] : zeroHash(height);
                next[i] = keccak256(abi.encodePacked(left, right));
            }
            level = next;
            idx /= 2;
        }
        return path;
    }

    /// @notice Root of the full leaf set, computed independently of the incremental tree.
    function root(bytes32[] memory leaves) internal pure returns (bytes32) {
        bytes32[] memory level = leaves;
        for (uint256 height = 0; height < MerkleTree.TREE_DEPTH; height++) {
            if (level.length == 0) {
                // Empty level: every remaining node is a zero subtree.
                return zeroHash(MerkleTree.TREE_DEPTH);
            }
            uint256 nextLen = (level.length + 1) / 2;
            bytes32[] memory next = new bytes32[](nextLen);
            for (uint256 i = 0; i < nextLen; i++) {
                bytes32 left = level[2 * i];
                bytes32 right = (2 * i + 1) < level.length ? level[2 * i + 1] : zeroHash(height);
                next[i] = keccak256(abi.encodePacked(left, right));
            }
            level = next;
        }
        return level[0];
    }
}
