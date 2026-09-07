// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IKauraxBatchInbox
/// @notice Data-availability entry point. The KAURAX batcher posts compressed L3
///         transaction data here, on the underlying L2.
///
/// @dev The batch payload lives in calldata, not storage. Only a commitment and the
///      metadata needed to index and reconstruct the chain are persisted. Nodes recover
///      L3 history by reading the calldata of these transactions from the L2. See
///      docs/data-availability.md.
interface IKauraxBatchInbox {
    event BatchSubmitted(
        uint256 indexed batchIndex,
        uint256 indexed l3StartBlock,
        uint256 indexed l3EndBlock,
        bytes32 dataCommitment,
        uint256 compressedSize,
        address submitter
    );

    /// @param _l3StartBlock First KAURAX block in the batch, inclusive.
    /// @param _l3EndBlock   Last KAURAX block in the batch, inclusive.
    /// @param _data         zlib-compressed, RLP-encoded L3 block payload.
    function submitBatch(uint256 _l3StartBlock, uint256 _l3EndBlock, bytes calldata _data) external;

    function batchCount() external view returns (uint256);
    function lastBatchL3Block() external view returns (uint256);
}
