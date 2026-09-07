// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KauraxL2OutputOracle} from "../src/L2/KauraxL2OutputOracle.sol";
import {Types} from "../src/libraries/Types.sol";

contract KauraxL2OutputOracleTest is Test {
    KauraxL2OutputOracle internal oracle;

    address internal proposer = makeAddr("proposer");
    address internal challenger = makeAddr("challenger");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant INTERVAL = 10; // L3 blocks between proposals
    uint256 internal constant L3_BLOCK_TIME = 2; // seconds
    uint256 internal constant START_BLOCK = 1;
    uint256 internal constant FINALIZATION = 120;

    function setUp() public {
        // Move away from timestamp 0 so STARTING_TIMESTAMP is in the past.
        vm.warp(10_000);
        oracle = new KauraxL2OutputOracle(
            INTERVAL, L3_BLOCK_TIME, START_BLOCK, block.timestamp - 1000, FINALIZATION, proposer, challenger
        );
    }

    function _propose(bytes32 root, uint256 l3Block) internal {
        vm.prank(proposer);
        oracle.proposeL2Output(root, l3Block, bytes32(0), 0);
    }

    function test_initialState() public view {
        assertEq(oracle.nextBlockNumber(), START_BLOCK);
        assertEq(oracle.nextOutputIndex(), 0);
        assertEq(oracle.latestBlockNumber(), START_BLOCK);
        assertEq(oracle.finalizationPeriodSeconds(), FINALIZATION);
    }

    function test_proposeAdvancesTheSchedule() public {
        _propose(keccak256("r1"), START_BLOCK);
        assertEq(oracle.nextOutputIndex(), 1);
        assertEq(oracle.latestBlockNumber(), START_BLOCK);
        assertEq(oracle.nextBlockNumber(), START_BLOCK + INTERVAL);

        _propose(keccak256("r2"), START_BLOCK + INTERVAL);
        Types.OutputProposal memory p = oracle.getL2Output(1);
        assertEq(p.outputRoot, keccak256("r2"));
        assertEq(uint256(p.l3BlockNumber), START_BLOCK + INTERVAL);
    }

    function test_onlyProposerMayPropose() public {
        vm.prank(stranger);
        vm.expectRevert(KauraxL2OutputOracle.NotProposer.selector);
        oracle.proposeL2Output(keccak256("r"), START_BLOCK, bytes32(0), 0);
    }

    function test_rejectsEmptyRoot() public {
        vm.prank(proposer);
        vm.expectRevert(KauraxL2OutputOracle.InvalidOutputRoot.selector);
        oracle.proposeL2Output(bytes32(0), START_BLOCK, bytes32(0), 0);
    }

    function test_rejectsOutOfOrderBlockNumber() public {
        _propose(keccak256("r1"), START_BLOCK);
        vm.prank(proposer);
        vm.expectRevert(
            abi.encodeWithSelector(
                KauraxL2OutputOracle.UnexpectedBlockNumber.selector, START_BLOCK + INTERVAL, START_BLOCK + 1
            )
        );
        oracle.proposeL2Output(keccak256("r2"), START_BLOCK + 1, bytes32(0), 0);
    }

    /// A proposal must not commit to L3 blocks that cannot exist yet at the configured
    /// block time. Cheap sanity bound while there is no fault proof.
    function test_rejectsBlockNumberInTheFuture() public {
        // A very large interval makes the second scheduled proposal fall beyond any
        // block height the chain could have reached by now.
        uint256 hugeInterval = 1_000_000;
        KauraxL2OutputOracle far = new KauraxL2OutputOracle(
            hugeInterval, L3_BLOCK_TIME, START_BLOCK, block.timestamp - 1, FINALIZATION, proposer, challenger
        );

        vm.prank(proposer);
        far.proposeL2Output(keccak256("r1"), START_BLOCK, bytes32(0), 0);

        uint256 next = far.nextBlockNumber();
        assertGt(far.computeL3Timestamp(next), block.timestamp, "test setup: not actually in the future");

        vm.prank(proposer);
        vm.expectRevert(KauraxL2OutputOracle.BlockNumberInFuture.selector);
        far.proposeL2Output(keccak256("r2"), next, bytes32(0), 0);
    }

    function test_l2BlockHashPinRejectsStaleView() public {
        vm.roll(100);
        vm.prank(proposer);
        vm.expectRevert(KauraxL2OutputOracle.L2BlockHashMismatch.selector);
        oracle.proposeL2Output(keccak256("r"), START_BLOCK, keccak256("not-the-real-hash"), 99);
    }

    function test_l2BlockHashPinAcceptsCanonicalView() public {
        vm.roll(100);
        bytes32 h = blockhash(99);
        vm.prank(proposer);
        oracle.proposeL2Output(keccak256("r"), START_BLOCK, h, 99);
        assertEq(oracle.nextOutputIndex(), 1);
    }

    function test_challengerCanDeleteUnfinalizedOutputs() public {
        _propose(keccak256("r1"), START_BLOCK);
        _propose(keccak256("r2"), START_BLOCK + INTERVAL);
        assertEq(oracle.nextOutputIndex(), 2);

        vm.prank(challenger);
        oracle.deleteL2Outputs(1);

        assertEq(oracle.nextOutputIndex(), 1);
        assertEq(oracle.latestBlockNumber(), START_BLOCK);
    }

    function test_challengerCannotDeleteFinalizedOutputs() public {
        _propose(keccak256("r1"), START_BLOCK);
        vm.warp(block.timestamp + FINALIZATION + 1);

        vm.prank(challenger);
        vm.expectRevert(KauraxL2OutputOracle.CannotDeleteFinalized.selector);
        oracle.deleteL2Outputs(0);
    }

    function test_onlyChallengerMayDelete() public {
        _propose(keccak256("r1"), START_BLOCK);
        vm.prank(proposer);
        vm.expectRevert(KauraxL2OutputOracle.NotChallenger.selector);
        oracle.deleteL2Outputs(0);
    }

    function test_getL2OutputIndexAfter() public {
        _propose(keccak256("r1"), START_BLOCK);
        _propose(keccak256("r2"), START_BLOCK + INTERVAL);
        _propose(keccak256("r3"), START_BLOCK + 2 * INTERVAL);

        assertEq(oracle.getL2OutputIndexAfter(START_BLOCK), 0);
        assertEq(oracle.getL2OutputIndexAfter(START_BLOCK + 1), 1);
        assertEq(oracle.getL2OutputIndexAfter(START_BLOCK + INTERVAL), 1);
        assertEq(oracle.getL2OutputIndexAfter(START_BLOCK + INTERVAL + 1), 2);
    }

    function test_revertsWhenNoOutputsExist() public {
        vm.expectRevert(KauraxL2OutputOracle.NoOutputs.selector);
        oracle.latestOutputIndex();
    }
}
