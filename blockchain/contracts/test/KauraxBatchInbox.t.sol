// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KauraxBatchInbox} from "../src/L2/KauraxBatchInbox.sol";

contract KauraxBatchInboxTest is Test {
    KauraxBatchInbox internal inbox;
    address internal owner = makeAddr("owner");
    address internal batcher = makeAddr("batcher");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        inbox = new KauraxBatchInbox(owner, batcher);
    }

    function _submit(uint256 start, uint256 end, bytes memory data) internal {
        vm.prank(batcher);
        inbox.submitBatch(start, end, data);
    }

    function test_submitRecordsCommitmentNotData() public {
        bytes memory data = hex"789c0badc0ffee";
        _submit(1, 10, data);

        (uint64 s, uint64 e,, uint64 size, bytes32 commit) = inbox.batches(0);
        assertEq(uint256(s), 1);
        assertEq(uint256(e), 10);
        assertEq(uint256(size), data.length);
        assertEq(commit, keccak256(data));
        assertEq(inbox.batchCount(), 1);
        assertEq(inbox.lastBatchL3Block(), 10);
    }

    function test_onlyBatcherMaySubmit() public {
        vm.prank(stranger);
        vm.expectRevert(KauraxBatchInbox.NotBatcher.selector);
        inbox.submitBatch(1, 10, hex"00");
    }

    function test_rejectsEmptyBatch() public {
        vm.prank(batcher);
        vm.expectRevert(KauraxBatchInbox.EmptyBatch.selector);
        inbox.submitBatch(1, 10, "");
    }

    function test_rejectsInvertedRange() public {
        vm.prank(batcher);
        vm.expectRevert(KauraxBatchInbox.InvalidRange.selector);
        inbox.submitBatch(10, 1, hex"00");
    }

    /// A gap in batches would make L3 history unreconstructable from L2 data.
    function test_rejectsGapInBatches() public {
        _submit(1, 10, hex"aa");
        vm.prank(batcher);
        vm.expectRevert(abi.encodeWithSelector(KauraxBatchInbox.NonContiguousBatch.selector, 11, 12));
        inbox.submitBatch(12, 20, hex"bb");
    }

    function test_rejectsOverlappingBatches() public {
        _submit(1, 10, hex"aa");
        vm.prank(batcher);
        vm.expectRevert(abi.encodeWithSelector(KauraxBatchInbox.NonContiguousBatch.selector, 11, 10));
        inbox.submitBatch(10, 20, hex"bb");
    }

    function test_acceptsContiguousBatches() public {
        _submit(1, 10, hex"aa");
        _submit(11, 20, hex"bb");
        _submit(21, 21, hex"cc");
        assertEq(inbox.batchCount(), 3);
        assertEq(inbox.lastBatchL3Block(), 21);
    }

    function test_ownerCanRotateBatcherKey() public {
        address newBatcher = makeAddr("newBatcher");
        vm.prank(owner);
        inbox.setBatcher(newBatcher);
        assertEq(inbox.batcher(), newBatcher);

        vm.prank(batcher);
        vm.expectRevert(KauraxBatchInbox.NotBatcher.selector);
        inbox.submitBatch(1, 10, hex"aa");

        vm.prank(newBatcher);
        inbox.submitBatch(1, 10, hex"aa");
    }

    function test_onlyOwnerMayRotate() public {
        vm.prank(batcher);
        vm.expectRevert(KauraxBatchInbox.NotOwner.selector);
        inbox.setBatcher(stranger);
    }
}
