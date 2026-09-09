// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Hashing} from "../src/libraries/Hashing.sol";
import {Types} from "../src/libraries/Types.sol";

/// @notice The consensus-critical hashing, pinned.
///
/// @dev `Hashing.sol` is mirrored in TypeScript at
///      `blockchain/l3/src/settlement/hashing.ts`. A divergence would either block every
///      withdrawal or admit one that was never made.
///
///      The three constants below are the shared pin. `blockchain/l3/test/hashing.test.ts`
///      asserts the *same literals* for the *same inputs*, so a change to either
///      implementation breaks a test on that side rather than silently drifting apart.
///      Before this existed, only the TypeScript side had tests, and those recomputed the
///      expectation with the same primitives they were testing — so a change to Hashing.sol
///      would have gone unnoticed by both suites.
contract HashingTest is Test {
    /// keccak256 over (version, stateRoot, withdrawalTreeRoot, latestBlockHash).
    bytes32 internal constant OUTPUT_ROOT_VECTOR =
        0x7e966d2edb1884abe7c8d9ca2a7483df72b49dbe2c74d16508b8c3dd1ab6ae36;

    /// keccak256 over (nonce, sender, target, value, gasLimit, keccak256(data)).
    bytes32 internal constant WITHDRAWAL_VECTOR =
        0x7ffde35851afa2b9f6c3b4299ca2c0d80cfdc730f1e7a799e03bcb2b996fe796;

    /// keccak256 over (l2BlockHash, logIndex, from, to, value, data).
    bytes32 internal constant DEPOSIT_VECTOR =
        0xcf8a12e93955f882a7271798941f9eca09d5c2353e51c72013653b3a21ed89ab;

    address internal constant SENDER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant TARGET = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    function _proof() internal pure returns (Types.OutputRootProof memory) {
        return Types.OutputRootProof({
            version: Hashing.OUTPUT_ROOT_VERSION,
            stateRoot: keccak256(hex"01"),
            withdrawalTreeRoot: keccak256(hex"02"),
            latestBlockHash: keccak256(hex"03")
        });
    }

    function _withdrawal() internal pure returns (Types.WithdrawalTransaction memory) {
        return Types.WithdrawalTransaction({
            nonce: 0, sender: SENDER, target: TARGET, value: 1 ether, gasLimit: 100_000, data: hex""
        });
    }

    function _deposit() internal pure returns (Types.DepositTransaction memory) {
        return Types.DepositTransaction({
            from: SENDER, to: TARGET, value: 2 ether, gasLimit: 200_000, isCreation: false, data: hex"c0ffee"
        });
    }

    // ------------------------------------------------------------------ pinned vectors --

    function test_outputRootMatchesTheSharedVector() public pure {
        assertEq(Hashing.hashOutputRoot(_proof()), OUTPUT_ROOT_VECTOR);
    }

    function test_withdrawalMatchesTheSharedVector() public pure {
        assertEq(Hashing.hashWithdrawal(_withdrawal()), WITHDRAWAL_VECTOR);
    }

    function test_depositMatchesTheSharedVector() public pure {
        assertEq(Hashing.hashDeposit(_deposit(), 7, keccak256(hex"04")), DEPOSIT_VECTOR);
    }

    function test_v0OutputRootVersionIsZero() public pure {
        assertEq(Hashing.OUTPUT_ROOT_VERSION, bytes32(0));
    }

    // ------------------------------------------------------------------- field coupling --

    function test_outputRootChangesWithEveryField() public pure {
        bytes32 base = Hashing.hashOutputRoot(_proof());

        Types.OutputRootProof memory p = _proof();
        p.stateRoot = keccak256(hex"ff");
        assertTrue(Hashing.hashOutputRoot(p) != base, "stateRoot not committed");

        p = _proof();
        p.withdrawalTreeRoot = keccak256(hex"ff");
        assertTrue(Hashing.hashOutputRoot(p) != base, "withdrawalTreeRoot not committed");

        p = _proof();
        p.latestBlockHash = keccak256(hex"ff");
        assertTrue(Hashing.hashOutputRoot(p) != base, "latestBlockHash not committed");

        p = _proof();
        p.version = bytes32(uint256(1));
        assertTrue(Hashing.hashOutputRoot(p) != base, "version not committed");
    }

    /// Swapping two same-typed fields must change the hash, or a prover could claim it meant
    /// the other arrangement after the fact.
    function test_outputRootDoesNotCommuteStateAndWithdrawalRoots() public pure {
        Types.OutputRootProof memory a = _proof();
        Types.OutputRootProof memory b = _proof();
        (b.stateRoot, b.withdrawalTreeRoot) = (a.withdrawalTreeRoot, a.stateRoot);
        assertTrue(Hashing.hashOutputRoot(a) != Hashing.hashOutputRoot(b));
    }

    function test_withdrawalChangesWithEveryField() public pure {
        bytes32 base = Hashing.hashWithdrawal(_withdrawal());

        Types.WithdrawalTransaction memory w = _withdrawal();
        w.nonce = 1;
        assertTrue(Hashing.hashWithdrawal(w) != base, "nonce not committed");

        w = _withdrawal();
        w.value += 1;
        assertTrue(Hashing.hashWithdrawal(w) != base, "value not committed");

        w = _withdrawal();
        w.gasLimit += 1;
        assertTrue(Hashing.hashWithdrawal(w) != base, "gasLimit not committed");

        w = _withdrawal();
        w.data = hex"01";
        assertTrue(Hashing.hashWithdrawal(w) != base, "data not committed");

        w = _withdrawal();
        w.target = SENDER;
        assertTrue(Hashing.hashWithdrawal(w) != base, "target not committed");

        w = _withdrawal();
        w.sender = TARGET;
        assertTrue(Hashing.hashWithdrawal(w) != base, "sender not committed");
    }

    function test_withdrawalDoesNotConfuseSenderAndTarget() public pure {
        Types.WithdrawalTransaction memory a = _withdrawal();
        Types.WithdrawalTransaction memory b = _withdrawal();
        (b.sender, b.target) = (a.target, a.sender);
        assertTrue(Hashing.hashWithdrawal(a) != Hashing.hashWithdrawal(b));
    }

    /// The data field is committed by its hash, so two withdrawals differing only in a long
    /// payload still differ — and the encoding cannot be made ambiguous by a length change.
    function testFuzz_withdrawalDataIsCommittedByHash(bytes memory dataA, bytes memory dataB) public pure {
        vm.assume(keccak256(dataA) != keccak256(dataB));
        Types.WithdrawalTransaction memory a = _withdrawal();
        Types.WithdrawalTransaction memory b = _withdrawal();
        a.data = dataA;
        b.data = dataB;
        assertTrue(Hashing.hashWithdrawal(a) != Hashing.hashWithdrawal(b));
    }

    function test_depositChangesWithLogIndexAndBlockHash() public pure {
        bytes32 base = Hashing.hashDeposit(_deposit(), 7, keccak256(hex"04"));
        assertTrue(Hashing.hashDeposit(_deposit(), 8, keccak256(hex"04")) != base, "logIndex not committed");
        assertTrue(
            Hashing.hashDeposit(_deposit(), 7, keccak256(hex"05")) != base, "l2BlockHash not committed"
        );
    }

    /// Two deposits in the same L2 block are distinguished only by their log index; if that
    /// were dropped, derivation would collapse them into one L3 transaction.
    function testFuzz_depositsInOneBlockAreDistinguishedByLogIndex(uint256 i, uint256 j) public pure {
        vm.assume(i != j);
        bytes32 h = keccak256(hex"04");
        assertTrue(Hashing.hashDeposit(_deposit(), i, h) != Hashing.hashDeposit(_deposit(), j, h));
    }
}
