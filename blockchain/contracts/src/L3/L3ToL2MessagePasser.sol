// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Types} from "../libraries/Types.sol";
import {Hashing} from "../libraries/Hashing.sol";
import {MerkleTree} from "../libraries/MerkleTree.sol";

/// @title L3ToL2MessagePasser
/// @notice KAURAX L3 predeploy. Origin point for every L3 -> L2 withdrawal.
///
/// @dev Deployed at a fixed predeploy address (see chain/genesis). Each withdrawal is
///      appended to an on-chain Merkle tree; the tree root is folded into the output root
///      that the proposer publishes on the L2. `KauraxPortal` then verifies a withdrawal
///      by checking its inclusion under that root.
///
///      Native value sent here is burned, keeping KAX supply on L3 equal to the value
///      escrowed by `KauraxPortal` on the L2.
contract L3ToL2MessagePasser {
    using MerkleTree for MerkleTree.Tree;

    /// @notice Monotonic withdrawal nonce.
    uint256 public messageNonce;

    /// @notice Total KAX burned by withdrawals originated here.
    uint256 public totalBurned;

    /// @notice withdrawalHash => leaf index + 1 (0 means "not present").
    mapping(bytes32 => uint256) internal _leafIndexPlusOne;

    MerkleTree.Tree internal _tree;

    event MessagePassed(
        uint256 indexed nonce,
        address indexed sender,
        address indexed target,
        uint256 value,
        uint256 gasLimit,
        bytes data,
        bytes32 withdrawalHash,
        uint256 leafIndex
    );

    event WithdrawalTreeRootUpdated(bytes32 root, uint256 leafCount);

    error GasLimitTooLow();
    error DataTooLarge();
    error BurnFailed();

    /// @notice Floor so that the L2-side call is executable.
    uint256 internal constant MIN_GAS_LIMIT = 21000;
    uint256 internal constant MAX_DATA_LENGTH = 120_000;

    /// @notice Begin a withdrawal to the underlying L2.
    /// @param _target   Address to call on the L2.
    /// @param _gasLimit Gas to forward to that call when it is finalized.
    /// @param _data     Calldata for that call.
    function initiateWithdrawal(address _target, uint256 _gasLimit, bytes memory _data) public payable {
        if (_gasLimit < MIN_GAS_LIMIT) revert GasLimitTooLow();
        if (_data.length > MAX_DATA_LENGTH) revert DataTooLarge();

        uint256 nonce = messageNonce;

        Types.WithdrawalTransaction memory wtx = Types.WithdrawalTransaction({
            nonce: nonce,
            sender: msg.sender,
            target: _target,
            value: msg.value,
            gasLimit: _gasLimit,
            data: _data
        });

        bytes32 withdrawalHash = Hashing.hashWithdrawal(wtx);
        uint256 leafIndex = _tree.insert(withdrawalHash);
        _leafIndexPlusOne[withdrawalHash] = leafIndex + 1;

        unchecked {
            messageNonce = nonce + 1;
            totalBurned += msg.value;
        }

        emit MessagePassed(nonce, msg.sender, _target, msg.value, _gasLimit, _data, withdrawalHash, leafIndex);
        emit WithdrawalTreeRootUpdated(_tree.root(), _tree.count);

        if (msg.value > 0) _burn(msg.value);
    }

    /// @notice Current root of the withdrawal tree. Read by the proposer when building an
    ///         output root, and by users when constructing an inclusion proof.
    function withdrawalTreeRoot() external view returns (bytes32) {
        return _tree.root();
    }

    function withdrawalCount() external view returns (uint256) {
        return _tree.count;
    }

    /// @notice Leaf index of a withdrawal, or reverts if unknown.
    function leafIndexOf(bytes32 _withdrawalHash) external view returns (uint256) {
        uint256 v = _leafIndexPlusOne[_withdrawalHash];
        require(v != 0, "L3ToL2MessagePasser: unknown withdrawal");
        return v - 1;
    }

    function sentMessages(bytes32 _withdrawalHash) external view returns (bool) {
        return _leafIndexPlusOne[_withdrawalHash] != 0;
    }

    /// @dev Value is destroyed by transferring it to a contract that immediately
    ///      self-destructs in the same transaction, which is still a balance-clearing
    ///      operation post-Cancun.
    function _burn(uint256 _amount) internal {
        new Burner{value: _amount}();
        // Defensive: the constructor cannot fail silently, but assert the accounting.
        if (address(this).balance != 0) revert BurnFailed();
    }
}

/// @notice Single-use sink that destroys the value it is created with.
contract Burner {
    constructor() payable {
        selfdestruct(payable(address(this)));
    }
}
