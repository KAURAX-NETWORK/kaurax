// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KauraxOneStepVerifier} from "../src/kvs/KauraxOneStepVerifier.sol";
import {KVSTypes} from "../src/kvs/KVSTypes.sol";
import {KVSMerkle} from "../src/kvs/KVSMerkle.sol";

/// @notice Differential test: the Solidity verifier against the TypeScript emulator.
///
/// @dev The fixture is produced by `pnpm --filter @kaurax/kvs fixtures`. Each case is one
///      step — a pre-state hash, the post-state hash the emulator produced, and the proof.
///      This contract hands the verifier the same input and requires the same output.
///
///      Neither implementation is the reference. If they disagree the test names the case
///      and both are suspect, which is the only honest position: a one-step verifier that
///      merely agreed with itself would prove nothing.
contract KVSVerifierTest is Test {
    KauraxOneStepVerifier internal verifier;

    string[] internal labels;
    bytes32[] internal preHashes;
    bytes32[] internal postHashes;
    bytes[] internal proofs;

    function setUp() public {
        verifier = new KauraxOneStepVerifier();

        bytes memory blob = vm.parseBytes(vm.readFile("test/fixtures/kvs-differential.hex"));
        (labels, preHashes, postHashes, proofs) = abi.decode(blob, (string[], bytes32[], bytes32[], bytes[]));
    }

    // ------------------------------------------------------------- differential --

    function test_emulatorAndVerifierAgreeOnEveryCase() public {
        assertGt(labels.length, 300, "fixture is suspiciously small; was it regenerated?");

        for (uint256 i = 0; i < labels.length; i++) {
            KauraxOneStepVerifier.StepProof memory p =
                abi.decode(proofs[i], (KauraxOneStepVerifier.StepProof));
            // try/catch rather than a bare call: a revert here means the two implementations
            // disagree about which accesses a step performs, and a bare panic would say only
            // that something went wrong somewhere in four hundred cases.
            try verifier.step(preHashes[i], p) returns (bytes32 got) {
                assertEq(got, postHashes[i], labels[i]);
            } catch {
                emit log_named_string("verifier reverted where the emulator did not", labels[i]);
                assertTrue(false, labels[i]);
            }
        }
    }

    /// @dev The corpus is only meaningful if it actually reaches the interesting states.
    ///      Counting them keeps a future edit from quietly gutting coverage while the
    ///      assertion above keeps passing.
    function test_fixtureCoversHaltsAndTermination() public view {
        uint256 halts;
        uint256 randoms;
        for (uint256 i = 0; i < labels.length; i++) {
            bytes32 h = keccak256(bytes(labels[i]));
            h; // silence unused; the checks below use the string directly
            if (_startsWith(labels[i], "halt-")) halts++;
            if (_startsWith(labels[i], "random-")) randoms++;
        }
        assertGt(halts, 14, "every halt reason should appear");
        assertGt(randoms, 100, "the random corpus should dominate");
    }

    // -------------------------------------------------------------- unit checks --

    /// @notice A terminal state is its own successor, which is what makes trace padding sound.
    function test_terminalStateSelfLoops() public view {
        KVSTypes.MachineState memory s = _emptyState();
        s.status = KVSTypes.STOPPED;

        KauraxOneStepVerifier.StepProof memory p;
        p.pre = s;
        p.code = "";

        bytes32 h = KVSTypes.hashState(s);
        assertEq(verifier.step(h, p), h);
    }

    /// @notice The verifier refuses a proof whose pre-state is not the one being disputed.
    ///         Without this a prover could answer a different question than the one asked.
    function test_rejectsMismatchedPreState() public {
        KVSTypes.MachineState memory s = _emptyState();
        KauraxOneStepVerifier.StepProof memory p;
        p.pre = s;
        p.code = "";

        bytes32 wrong = keccak256("not this state");
        vm.expectRevert(
            abi.encodeWithSelector(
                KauraxOneStepVerifier.PreStateMismatch.selector, wrong, KVSTypes.hashState(s)
            )
        );
        verifier.step(wrong, p);
    }

    /// @notice Code must match the committed hash, or a prover picks the program after the
    ///         dispute has narrowed to a step.
    function test_rejectsCodeThatDoesNotMatchTheCommitment() public {
        KVSTypes.MachineState memory s = _emptyState();
        s.codeHash = keccak256(hex"6001");

        KauraxOneStepVerifier.StepProof memory p;
        p.pre = s;
        p.code = hex"6002"; // a different program

        vm.expectRevert(
            abi.encodeWithSelector(
                KauraxOneStepVerifier.CodeMismatch.selector, s.codeHash, keccak256(hex"6002")
            )
        );
        verifier.step(KVSTypes.hashState(s), p);
    }

    /// @notice The contract states its own coverage on chain, so an integrator reading the
    ///         deployed bytecode cannot mistake the subset for the EVM.
    function test_coverageIsStatedOnChain() public view {
        string memory c = verifier.coverage();
        assertTrue(bytes(c).length > 100);
        assertTrue(_contains(c, "No CALL"));
        assertTrue(_contains(c, "not the Ethereum MPT"));
    }

    // ----------------------------------------------------------------- helpers --

    function _emptyState() internal pure returns (KVSTypes.MachineState memory s) {
        s.codeHash = keccak256("");
        s.stackRoot = KVSMerkle.zeroRoot(KVSTypes.STACK_HEIGHT);
        s.memRoot = KVSMerkle.zeroRoot(KVSTypes.MEMORY_HEIGHT);
        s.storageRoot = KVSMerkle.zeroRoot(KVSTypes.STORAGE_HEIGHT);
        s.gas = 100000;
    }

    function _startsWith(string memory _s, string memory _prefix) internal pure returns (bool) {
        bytes memory s = bytes(_s);
        bytes memory p = bytes(_prefix);
        if (s.length < p.length) return false;
        for (uint256 i = 0; i < p.length; i++) {
            if (s[i] != p[i]) return false;
        }
        return true;
    }

    function _contains(string memory _hay, string memory _needle) internal pure returns (bool) {
        bytes memory h = bytes(_hay);
        bytes memory n = bytes(_needle);
        if (n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }
}
