// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title MerkleTree
/// @notice Append-only binary Merkle tree over keccak256, plus proof verification.
///
/// @dev Design note. The canonical OP Stack proves withdrawals with a Merkle-Patricia
///      storage proof against `L2ToL1MessagePasser`. KAURAX's `devnet` profile instead
///      commits withdrawals to this append-only binary tree, whose root is carried in the
///      output root. The security property is the same — a withdrawal can only be
///      finalized if it is cryptographically included under a proposed root — but the
///      proof format differs. The `testnet` profile, which runs the canonical
///      `op-node`/`OptimismPortal`, uses the MPT proof instead. See docs/bridge.md.
///
///      Leaves are hashed as `keccak256(abi.encode(leaf))` by the caller before insertion;
///      internal nodes are `keccak256(left ++ right)`. Unfilled right siblings at a given
///      depth use a precomputed zero-hash chain, so the root is well defined for any
///      number of leaves.
library MerkleTree {
    /// @notice Maximum tree depth. 2^32 withdrawals is far beyond any practical need and
    ///         keeps the sibling array a fixed, cheap size.
    uint256 internal constant TREE_DEPTH = 32;

    error InvalidProofLength();
    error IndexOutOfRange();

    /// @notice Incremental append-only tree state.
    struct Tree {
        /// @dev Rightmost filled node at each depth, in the style of the deposit contract.
        bytes32[TREE_DEPTH] branch;
        /// @dev Number of leaves inserted.
        uint256 count;
    }

    /// @notice Zero hash for a subtree of the given height (height 0 == empty leaf).
    function zeroHash(uint256 _height) internal pure returns (bytes32 h) {
        h = bytes32(0);
        for (uint256 i = 0; i < _height; i++) {
            h = keccak256(abi.encodePacked(h, h));
        }
    }

    /// @notice Append a leaf. Returns the index it was inserted at.
    function insert(Tree storage _tree, bytes32 _leaf) internal returns (uint256 index) {
        index = _tree.count;
        uint256 size = index + 1;
        _tree.count = size;

        bytes32 node = _leaf;
        for (uint256 height = 0; height < TREE_DEPTH; height++) {
            if (size & 1 == 1) {
                _tree.branch[height] = node;
                return index;
            }
            node = keccak256(abi.encodePacked(_tree.branch[height], node));
            size /= 2;
        }
        // Unreachable for count < 2^32.
        revert IndexOutOfRange();
    }

    /// @notice Current root of the incremental tree.
    /// @dev The zero-hash chain is advanced alongside the walk, so this is O(depth)
    ///      hashes rather than O(depth^2).
    function root(Tree storage _tree) internal view returns (bytes32) {
        bytes32 node = bytes32(0);
        bytes32 zero = bytes32(0);
        uint256 size = _tree.count;
        for (uint256 height = 0; height < TREE_DEPTH; height++) {
            if (size & 1 == 1) {
                node = keccak256(abi.encodePacked(_tree.branch[height], node));
            } else {
                node = keccak256(abi.encodePacked(node, zero));
            }
            zero = keccak256(abi.encodePacked(zero, zero));
            size /= 2;
        }
        return node;
    }

    /// @notice Verify that `_leaf` sits at `_index` under `_root`.
    /// @param _proof Sibling hashes from the leaf upward. Length must equal TREE_DEPTH.
    function verify(bytes32 _root, bytes32 _leaf, uint256 _index, bytes32[] memory _proof)
        internal
        pure
        returns (bool)
    {
        if (_proof.length != TREE_DEPTH) revert InvalidProofLength();

        bytes32 node = _leaf;
        uint256 idx = _index;
        for (uint256 height = 0; height < TREE_DEPTH; height++) {
            if (idx & 1 == 1) {
                node = keccak256(abi.encodePacked(_proof[height], node));
            } else {
                node = keccak256(abi.encodePacked(node, _proof[height]));
            }
            idx /= 2;
        }
        return node == _root;
    }
}
