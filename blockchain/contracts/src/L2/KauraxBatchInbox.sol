// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IKauraxBatchInbox} from "../interfaces/IKauraxBatchInbox.sol";

/// @title KauraxBatchInbox
/// @notice Data-availability anchor for KAURAX, deployed on the underlying L2.
/// @dev Batch bytes are never written to storage — they exist only as calldata of the
///      submitting transaction, which the underlying L2 in turn makes available to
///      Ethereum. Storing a commitment keeps recovery verifiable without paying for
///      duplicate storage. See docs/data-availability.md for the recovery procedure.
contract KauraxBatchInbox is IKauraxBatchInbox {
    /// @notice Address permitted to submit batches.
    address public batcher;

    /// @notice Owner, able to rotate the batcher key.
    address public owner;

    uint256 public batchCount;
    uint256 public lastBatchL3Block;

    struct BatchMeta {
        uint64 l3StartBlock;
        uint64 l3EndBlock;
        uint64 l2Timestamp;
        uint64 compressedSize;
        bytes32 dataCommitment;
    }

    /// @notice Batch metadata by index. The data itself is in the transaction calldata.
    mapping(uint256 => BatchMeta) public batches;

    event BatcherUpdated(address indexed previous, address indexed current);
    event OwnerUpdated(address indexed previous, address indexed current);

    error NotBatcher();
    error NotOwner();
    error EmptyBatch();
    error NonContiguousBatch(uint256 expectedStart, uint256 gotStart);
    error InvalidRange();
    error ZeroAddress();

    modifier onlyBatcher() {
        if (msg.sender != batcher) revert NotBatcher();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner, address _batcher) {
        if (_owner == address(0) || _batcher == address(0)) revert ZeroAddress();
        owner = _owner;
        batcher = _batcher;
    }

    /// @inheritdoc IKauraxBatchInbox
    function submitBatch(uint256 _l3StartBlock, uint256 _l3EndBlock, bytes calldata _data)
        external
        onlyBatcher
    {
        if (_data.length == 0) revert EmptyBatch();
        if (_l3EndBlock < _l3StartBlock) revert InvalidRange();

        // Batches must be contiguous: a gap would make L3 history unreconstructable
        // from L2 data alone.
        uint256 expectedStart = batchCount == 0 ? _l3StartBlock : lastBatchL3Block + 1;
        if (_l3StartBlock != expectedStart) revert NonContiguousBatch(expectedStart, _l3StartBlock);

        uint256 index = batchCount;
        bytes32 commitment = keccak256(_data);

        batches[index] = BatchMeta({
            l3StartBlock: uint64(_l3StartBlock),
            l3EndBlock: uint64(_l3EndBlock),
            l2Timestamp: uint64(block.timestamp),
            compressedSize: uint64(_data.length),
            dataCommitment: commitment
        });

        batchCount = index + 1;
        lastBatchL3Block = _l3EndBlock;

        emit BatchSubmitted(index, _l3StartBlock, _l3EndBlock, commitment, _data.length, msg.sender);
    }

    function setBatcher(address _batcher) external onlyOwner {
        if (_batcher == address(0)) revert ZeroAddress();
        emit BatcherUpdated(batcher, _batcher);
        batcher = _batcher;
    }

    function setOwner(address _owner) external onlyOwner {
        if (_owner == address(0)) revert ZeroAddress();
        emit OwnerUpdated(owner, _owner);
        owner = _owner;
    }
}
