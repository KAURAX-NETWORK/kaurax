// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {KauraxPortal} from "../src/L2/KauraxPortal.sol";
import {IKauraxPortal} from "../src/interfaces/IKauraxPortal.sol";
import {KauraxL2OutputOracle} from "../src/L2/KauraxL2OutputOracle.sol";
import {L3ToL2MessagePasser} from "../src/L3/L3ToL2MessagePasser.sol";
import {Types} from "../src/libraries/Types.sol";
import {Hashing} from "../src/libraries/Hashing.sol";
import {MerkleTree} from "../src/libraries/MerkleTree.sol";
import {MerkleHelper} from "./helpers/MerkleHelper.sol";
import {AddressAliasHelper} from "../src/libraries/AddressAliasHelper.sol";

contract Reverter {
    receive() external payable {
        revert("nope");
    }
}

contract ValueSink {
    uint256 public received;
    address public lastPortalSender;

    receive() external payable {
        received += msg.value;
    }

    function record(address portal) external payable {
        received += msg.value;
        lastPortalSender = KauraxPortal(payable(portal)).l3Sender();
    }
}

contract Relayer {
    function finalize(address portal, Types.WithdrawalTransaction memory wtx) external {
        KauraxPortal(payable(portal)).finalizeWithdrawalTransaction(wtx);
    }
}

contract Depositor {
    function deposit(address portal, address to) external payable {
        KauraxPortal(payable(portal)).depositTransaction{value: msg.value}(to, msg.value, 21000, false, "");
    }
}

/// @notice Exercises the full L3 -> L2 withdrawal lifecycle against a real message passer
///         and a real output oracle. The "proposer" here does what kaurax-node's proposer
///         does: read the withdrawal tree root off the L3, fold it into an output root,
///         publish it.
contract KauraxPortalTest is Test {
    KauraxPortal internal portal;
    KauraxL2OutputOracle internal oracle;
    L3ToL2MessagePasser internal passer;

    address internal proposer = makeAddr("proposer");
    address internal challenger = makeAddr("challenger");
    address internal guardian = makeAddr("guardian");
    address internal sequencerAddress = makeAddr("sequencer");

    /// L2 blocks the sequencer has to include a forced transaction.
    uint256 internal constant FORCED_WINDOW = 100;
    address internal alice = makeAddr("alice");
    address internal relayer = makeAddr("relayer");

    uint256 internal constant INTERVAL = 10;
    uint256 internal constant L3_BLOCK_TIME = 2;
    uint256 internal constant START_BLOCK = 1;
    uint256 internal constant FINALIZATION = 120;

    /// Leaves recorded off-chain, mirroring how the node rebuilds the tree from events.
    bytes32[] internal leaves;

    function setUp() public {
        vm.warp(10_000);
        oracle = new KauraxL2OutputOracle(
            INTERVAL,
            L3_BLOCK_TIME,
            START_BLOCK,
            block.timestamp - 1000,
            FINALIZATION,
            proposer,
            challenger,
            0
        );
        portal = new KauraxPortal(address(oracle), guardian, sequencerAddress, FORCED_WINDOW);
        passer = new L3ToL2MessagePasser();

        vm.deal(alice, 100 ether);
        vm.deal(address(this), 1000 ether);
    }

    // ------------------------------------------------------------------ //
    //                             Deposits                               //
    // ------------------------------------------------------------------ //

    function test_depositEscrowsValueAndEmits() public {
        vm.expectEmit(true, true, true, false, address(portal));
        emit IKauraxPortal.TransactionDeposited(alice, alice, 0, "");

        vm.prank(alice);
        portal.depositTransaction{value: 5 ether}(alice, 5 ether, 21000, false, "");

        assertEq(address(portal).balance, 5 ether, "value not escrowed");
        assertEq(portal.depositCount(), 1);
    }

    function test_receiveIsADeposit() public {
        vm.prank(alice);
        (bool ok,) = address(portal).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(portal).balance, 1 ether);
        assertEq(portal.depositCount(), 1);
    }

    /// A contract depositor must arrive on L3 under an aliased address, so it cannot
    /// impersonate an EOA whose key someone holds.
    function test_contractSenderIsAliased() public {
        Depositor d = new Depositor();
        vm.recordLogs();
        d.deposit{value: 1 ether}(address(portal), alice);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        // TransactionDeposited(address indexed from, address indexed to, uint256 indexed version, bytes)
        address from = address(uint160(uint256(logs[0].topics[1])));
        assertEq(from, AddressAliasHelper.applyAlias(address(d)), "contract sender not aliased");
        assertTrue(from != address(d));
    }

    function test_eoaSenderIsNotAliased() public {
        vm.recordLogs();
        vm.prank(alice);
        portal.depositTransaction{value: 1 ether}(alice, 1 ether, 21000, false, "");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(address(uint160(uint256(logs[0].topics[1]))), alice);
    }

    function test_depositRejectsLowGasLimit() public {
        vm.prank(alice);
        vm.expectRevert(KauraxPortal.GasLimitTooLow.selector);
        portal.depositTransaction{value: 1 ether}(alice, 1 ether, 20999, false, "");
    }

    function test_depositRejectsCreationWithTarget() public {
        vm.prank(alice);
        vm.expectRevert(KauraxPortal.CreationWithNonZeroTarget.selector);
        portal.depositTransaction{value: 0}(alice, 0, 21000, true, hex"60006000");
    }

    function test_depositRejectsOversizedData() public {
        bytes memory big = new bytes(120_001);
        vm.prank(alice);
        vm.expectRevert(KauraxPortal.DataTooLarge.selector);
        portal.depositTransaction{value: 0}(alice, 0, 100000, false, big);
    }

    function test_guardianCanPauseDeposits() public {
        vm.prank(guardian);
        portal.pause();
        assertTrue(portal.paused());

        vm.prank(alice);
        vm.expectRevert(KauraxPortal.IsPaused.selector);
        portal.depositTransaction{value: 1 ether}(alice, 1 ether, 21000, false, "");

        vm.prank(guardian);
        portal.unpause();
        vm.prank(alice);
        portal.depositTransaction{value: 1 ether}(alice, 1 ether, 21000, false, "");
    }

    function test_onlyGuardianMayPause() public {
        vm.prank(alice);
        vm.expectRevert(KauraxPortal.NotGuardian.selector);
        portal.pause();
    }

    // ------------------------------------------------------------------ //
    //                            Withdrawals                             //
    // ------------------------------------------------------------------ //

    /// Originate a withdrawal on the L3 message passer and record the leaf, exactly as
    /// the node does when it observes MessagePassed.
    function _initiateWithdrawal(address sender, address target, uint256 value, bytes memory data)
        internal
        returns (Types.WithdrawalTransaction memory wtx)
    {
        uint256 nonce = passer.messageNonce();
        wtx = Types.WithdrawalTransaction({
            nonce: nonce, sender: sender, target: target, value: value, gasLimit: 100_000, data: data
        });

        vm.deal(sender, sender.balance + value);
        vm.prank(sender);
        passer.initiateWithdrawal{value: value}(target, 100_000, data);

        leaves.push(Hashing.hashWithdrawal(wtx));
    }

    /// Publish an output root committing to the current withdrawal tree.
    function _propose(uint256 l3Block) internal returns (uint256 index, Types.OutputRootProof memory p) {
        p = Types.OutputRootProof({
            version: Hashing.OUTPUT_ROOT_VERSION,
            stateRoot: keccak256(abi.encodePacked("state", l3Block)),
            withdrawalTreeRoot: passer.withdrawalTreeRoot(),
            latestBlockHash: keccak256(abi.encodePacked("block", l3Block))
        });
        index = oracle.nextOutputIndex();
        vm.prank(proposer);
        oracle.proposeL2Output(Hashing.hashOutputRoot(p), l3Block, bytes32(0), 0);
    }

    function _proofFor(uint256 leafIndex) internal view returns (bytes32[] memory) {
        return MerkleHelper.proof(leaves, leafIndex);
    }

    function test_endToEndWithdrawal() public {
        // Back the withdrawal with escrow from a prior deposit.
        vm.prank(alice);
        portal.depositTransaction{value: 10 ether}(alice, 10 ether, 21000, false, "");

        ValueSink sink = new ValueSink();
        Types.WithdrawalTransaction memory wtx = _initiateWithdrawal(alice, address(sink), 3 ether, "");

        (uint256 idx, Types.OutputRootProof memory rootProof) = _propose(START_BLOCK);

        portal.proveWithdrawalTransaction(wtx, idx, rootProof, 0, _proofFor(0));

        (bytes32 provenRoot, uint128 ts,) = portal.provenWithdrawals(Hashing.hashWithdrawal(wtx));
        assertEq(provenRoot, Hashing.hashOutputRoot(rootProof));
        assertEq(uint256(ts), block.timestamp);

        // Cannot finalize before the challenge window elapses.
        vm.expectRevert(KauraxPortal.ChallengePeriodNotElapsed.selector);
        portal.finalizeWithdrawalTransaction(wtx);

        vm.warp(block.timestamp + FINALIZATION + 1);

        uint256 sinkBefore = address(sink).balance;
        vm.prank(relayer);
        portal.finalizeWithdrawalTransaction(wtx);

        assertEq(address(sink).balance - sinkBefore, 3 ether, "value not delivered");
        assertTrue(portal.finalizedWithdrawals(Hashing.hashWithdrawal(wtx)));
        assertEq(portal.l3Sender(), address(1), "l3Sender not reset");
    }

    function test_withdrawalTargetSeesL3Sender() public {
        vm.prank(alice);
        portal.depositTransaction{value: 10 ether}(alice, 10 ether, 21000, false, "");

        ValueSink sink = new ValueSink();
        bytes memory data = abi.encodeCall(ValueSink.record, (address(portal)));
        Types.WithdrawalTransaction memory wtx = _initiateWithdrawal(alice, address(sink), 1 ether, data);

        (uint256 idx, Types.OutputRootProof memory rp) = _propose(START_BLOCK);
        portal.proveWithdrawalTransaction(wtx, idx, rp, 0, _proofFor(0));
        vm.warp(block.timestamp + FINALIZATION + 1);
        portal.finalizeWithdrawalTransaction(wtx);

        assertEq(sink.lastPortalSender(), alice, "target could not read the L3 sender");
    }

    function test_cannotFinalizeTwice() public {
        vm.prank(alice);
        portal.depositTransaction{value: 10 ether}(alice, 10 ether, 21000, false, "");

        ValueSink sink = new ValueSink();
        Types.WithdrawalTransaction memory wtx = _initiateWithdrawal(alice, address(sink), 1 ether, "");
        (uint256 idx, Types.OutputRootProof memory rp) = _propose(START_BLOCK);
        portal.proveWithdrawalTransaction(wtx, idx, rp, 0, _proofFor(0));
        vm.warp(block.timestamp + FINALIZATION + 1);
        portal.finalizeWithdrawalTransaction(wtx);

        vm.expectRevert(KauraxPortal.WithdrawalAlreadyFinalized.selector);
        portal.finalizeWithdrawalTransaction(wtx);
    }

    /// The core security property: a withdrawal that was never included in the tree the
    /// output root commits to cannot be proven, whatever the caller claims.
    function test_cannotProveForgedWithdrawal() public {
        _initiateWithdrawal(alice, makeAddr("real"), 1 ether, "");
        (uint256 idx, Types.OutputRootProof memory rp) = _propose(START_BLOCK);

        Types.WithdrawalTransaction memory forged = Types.WithdrawalTransaction({
            nonce: 999,
            sender: alice,
            target: makeAddr("attacker"),
            value: 100 ether,
            gasLimit: 100_000,
            data: ""
        });

        vm.expectRevert(KauraxPortal.InvalidWithdrawalInclusionProof.selector);
        portal.proveWithdrawalTransaction(forged, idx, rp, 0, _proofFor(0));
    }

    function test_cannotProveWithMismatchedOutputRootPreimage() public {
        Types.WithdrawalTransaction memory wtx = _initiateWithdrawal(alice, makeAddr("t"), 1 ether, "");
        (uint256 idx, Types.OutputRootProof memory rp) = _propose(START_BLOCK);

        rp.stateRoot = keccak256("tampered");

        vm.expectRevert(KauraxPortal.InvalidOutputRootProof.selector);
        portal.proveWithdrawalTransaction(wtx, idx, rp, 0, _proofFor(0));
    }

    function test_cannotProveTwiceAgainstSameRoot() public {
        Types.WithdrawalTransaction memory wtx = _initiateWithdrawal(alice, makeAddr("t"), 1 ether, "");
        (uint256 idx, Types.OutputRootProof memory rp) = _propose(START_BLOCK);
        portal.proveWithdrawalTransaction(wtx, idx, rp, 0, _proofFor(0));

        vm.expectRevert(KauraxPortal.AlreadyProvenAtSameRoot.selector);
        portal.proveWithdrawalTransaction(wtx, idx, rp, 0, _proofFor(0));
    }

    /// If the challenger deletes the proposal a withdrawal was proven against, that
    /// withdrawal must not finalize. It has to be re-proven against a live proposal.
    function test_deletedProposalBlocksFinalization() public {
        vm.prank(alice);
        portal.depositTransaction{value: 10 ether}(alice, 10 ether, 21000, false, "");

        ValueSink sink = new ValueSink();
        Types.WithdrawalTransaction memory wtx = _initiateWithdrawal(alice, address(sink), 1 ether, "");
        (uint256 idx, Types.OutputRootProof memory rp) = _propose(START_BLOCK);
        portal.proveWithdrawalTransaction(wtx, idx, rp, 0, _proofFor(0));

        vm.prank(challenger);
        oracle.deleteL2Outputs(idx);

        vm.warp(block.timestamp + FINALIZATION + 1);

        // The proposal no longer exists at that index.
        vm.expectRevert(KauraxL2OutputOracle.OutputIndexOutOfBounds.selector);
        portal.finalizeWithdrawalTransaction(wtx);
    }

    /// After a delete-and-republish, re-proving against the new root is allowed and the
    /// challenge clock restarts.
    function test_reproveAfterProposalReplaced() public {
        vm.prank(alice);
        portal.depositTransaction{value: 10 ether}(alice, 10 ether, 21000, false, "");

        ValueSink sink = new ValueSink();
        Types.WithdrawalTransaction memory wtx = _initiateWithdrawal(alice, address(sink), 1 ether, "");
        (uint256 idx, Types.OutputRootProof memory rp) = _propose(START_BLOCK);
        portal.proveWithdrawalTransaction(wtx, idx, rp, 0, _proofFor(0));

        vm.prank(challenger);
        oracle.deleteL2Outputs(idx);

        // Proposer republishes a different root for the same height.
        Types.OutputRootProof memory rp2 = Types.OutputRootProof({
            version: Hashing.OUTPUT_ROOT_VERSION,
            stateRoot: keccak256("state-v2"),
            withdrawalTreeRoot: passer.withdrawalTreeRoot(),
            latestBlockHash: keccak256("block-v2")
        });
        vm.prank(proposer);
        oracle.proposeL2Output(Hashing.hashOutputRoot(rp2), START_BLOCK, bytes32(0), 0);

        portal.proveWithdrawalTransaction(wtx, idx, rp2, 0, _proofFor(0));
        vm.warp(block.timestamp + FINALIZATION + 1);
        portal.finalizeWithdrawalTransaction(wtx);

        assertEq(address(sink).balance, 1 ether);
    }

    function test_cannotFinalizeUnproven() public {
        Types.WithdrawalTransaction memory wtx = Types.WithdrawalTransaction({
            nonce: 0, sender: alice, target: makeAddr("t"), value: 1 ether, gasLimit: 100_000, data: ""
        });
        vm.expectRevert(KauraxPortal.WithdrawalNotProven.selector);
        portal.finalizeWithdrawalTransaction(wtx);
    }

    function test_withdrawalCannotTargetThePortal() public {
        Types.WithdrawalTransaction memory wtx = Types.WithdrawalTransaction({
            nonce: 0, sender: alice, target: address(portal), value: 0, gasLimit: 100_000, data: ""
        });
        Types.OutputRootProof memory rp;
        vm.expectRevert(KauraxPortal.TargetIsPortal.selector);
        portal.proveWithdrawalTransaction(wtx, 0, rp, 0, new bytes32[](32));
    }

    function test_multipleWithdrawalsEachProveIndependently() public {
        vm.prank(alice);
        portal.depositTransaction{value: 20 ether}(alice, 20 ether, 21000, false, "");

        ValueSink a = new ValueSink();
        ValueSink b = new ValueSink();
        ValueSink c = new ValueSink();

        Types.WithdrawalTransaction memory w0 = _initiateWithdrawal(alice, address(a), 1 ether, "");
        Types.WithdrawalTransaction memory w1 = _initiateWithdrawal(alice, address(b), 2 ether, "");
        Types.WithdrawalTransaction memory w2 = _initiateWithdrawal(alice, address(c), 3 ether, "");

        (uint256 idx, Types.OutputRootProof memory rp) = _propose(START_BLOCK);

        portal.proveWithdrawalTransaction(w0, idx, rp, 0, _proofFor(0));
        portal.proveWithdrawalTransaction(w1, idx, rp, 1, _proofFor(1));
        portal.proveWithdrawalTransaction(w2, idx, rp, 2, _proofFor(2));

        vm.warp(block.timestamp + FINALIZATION + 1);
        portal.finalizeWithdrawalTransaction(w0);
        portal.finalizeWithdrawalTransaction(w1);
        portal.finalizeWithdrawalTransaction(w2);

        assertEq(address(a).balance, 1 ether);
        assertEq(address(b).balance, 2 ether);
        assertEq(address(c).balance, 3 ether);
    }

    /// A withdrawal cannot be proven at a leaf index other than its own, even with a
    /// well-formed proof for that other index.
    function test_cannotSwapLeafIndex() public {
        _initiateWithdrawal(alice, makeAddr("a"), 1 ether, "");
        Types.WithdrawalTransaction memory w1 = _initiateWithdrawal(alice, makeAddr("b"), 2 ether, "");
        (uint256 idx, Types.OutputRootProof memory rp) = _propose(START_BLOCK);

        vm.expectRevert(KauraxPortal.InvalidWithdrawalInclusionProof.selector);
        portal.proveWithdrawalTransaction(w1, idx, rp, 0, _proofFor(0));
    }

    function test_pausedBlocksProveAndFinalize() public {
        Types.WithdrawalTransaction memory wtx = _initiateWithdrawal(alice, makeAddr("t"), 0, "");
        (uint256 idx, Types.OutputRootProof memory rp) = _propose(START_BLOCK);

        vm.prank(guardian);
        portal.pause();

        vm.expectRevert(KauraxPortal.IsPaused.selector);
        portal.proveWithdrawalTransaction(wtx, idx, rp, 0, _proofFor(0));

        vm.expectRevert(KauraxPortal.IsPaused.selector);
        portal.finalizeWithdrawalTransaction(wtx);
    }

    /// A withdrawal whose target reverts is still consumed, and the outcome is reported in
    /// the event rather than by reverting. Critically, this must not depend on whether the
    /// caller is an EOA or a contract: identical inputs must produce identical state.
    function test_failedWithdrawalIsConsumedRegardlessOfCallerType() public {
        vm.prank(alice);
        portal.depositTransaction{value: 10 ether}(alice, 10 ether, 21000, false, "");

        Reverter target = new Reverter();
        Types.WithdrawalTransaction memory wtx = _initiateWithdrawal(alice, address(target), 1 ether, "");
        (uint256 idx, Types.OutputRootProof memory rp) = _propose(START_BLOCK);
        portal.proveWithdrawalTransaction(wtx, idx, rp, 0, _proofFor(0));
        vm.warp(block.timestamp + FINALIZATION + 1);

        uint256 portalBefore = address(portal).balance;

        vm.expectEmit(true, false, false, true, address(portal));
        emit IKauraxPortal.WithdrawalFinalized(Hashing.hashWithdrawal(wtx), false);

        // Submitted directly by an EOA.
        vm.prank(relayer, relayer);
        portal.finalizeWithdrawalTransaction(wtx);

        assertTrue(portal.finalizedWithdrawals(Hashing.hashWithdrawal(wtx)), "not consumed");
        assertEq(address(portal).balance, portalBefore, "value left the portal on a failed call");
        assertEq(portal.l3Sender(), address(1), "l3Sender not reset after a failed call");

        // And it cannot be retried.
        vm.expectRevert(KauraxPortal.WithdrawalAlreadyFinalized.selector);
        portal.finalizeWithdrawalTransaction(wtx);
    }

    /// The same scenario driven through a contract must reach the same state.
    function test_failedWithdrawalViaContractCallerMatchesEoa() public {
        vm.prank(alice);
        portal.depositTransaction{value: 10 ether}(alice, 10 ether, 21000, false, "");

        Reverter target = new Reverter();
        Types.WithdrawalTransaction memory wtx = _initiateWithdrawal(alice, address(target), 1 ether, "");
        (uint256 idx, Types.OutputRootProof memory rp) = _propose(START_BLOCK);
        portal.proveWithdrawalTransaction(wtx, idx, rp, 0, _proofFor(0));
        vm.warp(block.timestamp + FINALIZATION + 1);

        Relayer relay = new Relayer();
        relay.finalize(address(portal), wtx);

        assertTrue(portal.finalizedWithdrawals(Hashing.hashWithdrawal(wtx)));
        assertEq(portal.l3Sender(), address(1));
    }

    function test_messagePasserBurnsValue() public {
        uint256 before = passer.totalBurned();
        _initiateWithdrawal(alice, makeAddr("t"), 4 ether, "");
        assertEq(passer.totalBurned() - before, 4 ether);
        assertEq(address(passer).balance, 0, "message passer retained value");
    }
}
