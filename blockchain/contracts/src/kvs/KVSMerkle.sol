// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title KVSMerkle
/// @notice Fixed-height binary Merkle trees with zero-value defaults, used to commit the
///         stack, memory and storage of the KAURAX Verifiable Subset machine.
///
/// @dev Why not `libraries/MerkleTree.sol`: that tree is append-only and pinned to depth 32.
///      A machine state needs *updates* at arbitrary indices and three different heights
///      (10 for the stack, 16 for memory, 256 for storage). The hashing convention is
///      identical — internal nodes are `keccak256(left ++ right)`, empty subtrees use a
///      zero-hash chain — so a leaf proved here would prove there at the same height.
///
///      `computeRoot` is deliberately the only primitive. Verification is
///      `computeRoot(oldLeaf, ...) == expectedRoot`, and an update is
///      `computeRoot(newLeaf, ...)` with the *same* sibling array. One function gives both,
///      and it is impossible to update without having proved the prior value — which is the
///      property a one-step verifier depends on.
library KVSMerkle {
    error IndexOutOfRange(uint256 index, uint256 height);
    /// @notice The supplied leaf does not sit at that index under that root.
    error BadMerkleProof(bytes32 expectedRoot, bytes32 computedRoot);

    /// @notice Root of a completely empty tree of the given height.
    /// @dev height 0 is a single zero leaf.
    function zeroRoot(uint256 _height) internal pure returns (bytes32 h) {
        h = bytes32(0);
        for (uint256 i = 0; i < _height; i++) {
            h = keccak256(abi.encodePacked(h, h));
        }
    }

    /// @notice Fold `_leaf` at `_index` up through `_siblings` and return the resulting root.
    /// @param _siblings Sibling hashes from the leaf upward. Length fixes the tree height.
    ///
    /// @dev The index must address a leaf that exists at this height. Without that check a
    ///      prover could supply an index whose high bits are ignored by the fold and prove
    ///      the same leaf at many positions.
    function computeRoot(bytes32 _leaf, uint256 _index, bytes32[] memory _siblings)
        internal
        pure
        returns (bytes32)
    {
        uint256 height = _siblings.length;
        // 1 << 256 overflows; at height 256 every uint256 index is in range by construction.
        if (height < 256 && _index >= (uint256(1) << height)) revert IndexOutOfRange(_index, height);

        bytes32 node = _leaf;
        uint256 idx = _index;
        for (uint256 i = 0; i < height; i++) {
            node = (idx & 1 == 1)
                ? keccak256(abi.encodePacked(_siblings[i], node))
                : keccak256(abi.encodePacked(node, _siblings[i]));
            idx >>= 1;
        }
        return node;
    }

    /// @notice Prove `_oldLeaf` sits at `_index` under `_root`, then return the root that
    ///         replacing it with `_newLeaf` produces.
    /// @dev Reverts if the old value does not prove. This is the only way the verifier
    ///      writes to a committed structure.
    function update(
        bytes32 _root,
        uint256 _index,
        bytes32 _oldLeaf,
        bytes32 _newLeaf,
        bytes32[] memory _siblings
    ) internal pure returns (bytes32) {
        bytes32 computed = computeRoot(_oldLeaf, _index, _siblings);
        if (computed != _root) revert BadMerkleProof(_root, computed);
        return computeRoot(_newLeaf, _index, _siblings);
    }
}
