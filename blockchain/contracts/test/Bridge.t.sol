// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {KauraxPortal} from "../src/L2/KauraxPortal.sol";
import {KauraxL2OutputOracle} from "../src/L2/KauraxL2OutputOracle.sol";
import {KauraxL2ERC20Bridge} from "../src/L2/KauraxL2ERC20Bridge.sol";
import {KauraxL3ERC20Bridge} from "../src/L3/KauraxL3ERC20Bridge.sol";
import {KauraxBridgedERC20} from "../src/L3/KauraxBridgedERC20.sol";
import {L3ToL2MessagePasser} from "../src/L3/L3ToL2MessagePasser.sol";
import {KauraxToken} from "../src/examples/KauraxToken.sol";
import {Types} from "../src/libraries/Types.sol";
import {Hashing} from "../src/libraries/Hashing.sol";
import {AddressAliasHelper} from "../src/libraries/AddressAliasHelper.sol";
import {MerkleHelper} from "./helpers/MerkleHelper.sol";

/// @notice Round-trips an ERC-20 across the bridge.
///
/// @dev The L2 and L3 contracts are deployed in the same test EVM, so the parts a real
///      deployment gets from the node are performed explicitly here: the derivation step
///      (calling the L3 bridge as the *aliased* L2 bridge) and the proposer step
///      (publishing an output root over the withdrawal tree). Those substitutions are the
///      only simulated pieces; every access-control and accounting path is real.
contract BridgeTest is Test {
    KauraxL2OutputOracle internal oracle;
    KauraxPortal internal portal;
    KauraxL2ERC20Bridge internal l2Bridge;
    KauraxL3ERC20Bridge internal l3Bridge;
    L3ToL2MessagePasser internal passer;
    KauraxToken internal l2Token;
    KauraxBridgedERC20 internal l3Token;

    address internal proposer = makeAddr("proposer");
    address internal challenger = makeAddr("challenger");
    address internal guardian = makeAddr("guardian");
    address internal sequencerAddress = makeAddr("sequencer");

    /// L2 blocks the sequencer has to include a forced transaction.
    uint256 internal constant FORCED_WINDOW = 100;
    address internal alice = makeAddr("alice");

    uint256 internal constant FINALIZATION = 120;
    bytes32[] internal leaves;

    function setUp() public {
        vm.warp(10_000);
        oracle =
            new KauraxL2OutputOracle(10, 2, 1, block.timestamp - 1000, FINALIZATION, proposer, challenger);
        portal = new KauraxPortal(address(oracle), guardian, sequencerAddress, FORCED_WINDOW);
        passer = new L3ToL2MessagePasser();

        // Counterpart addresses are circular, so precompute the L3 bridge address.
        address predictedL3Bridge = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        l2Bridge = new KauraxL2ERC20Bridge(address(portal), predictedL3Bridge);
        l3Bridge = new KauraxL3ERC20Bridge(address(passer), address(l2Bridge));
        assertEq(address(l3Bridge), predictedL3Bridge, "counterpart prediction failed");

        l2Token = new KauraxToken("Test USD", "TUSD", 18, 1_000_000e18);
        l3Token = new KauraxBridgedERC20(address(l3Bridge), address(l2Token), "Test USD (KAURAX)", "TUSD", 18);

        l2Token.transfer(alice, 1000e18);
    }

    function test_depositMintsOnL3() public {
        vm.startPrank(alice);
        l2Token.approve(address(l2Bridge), 100e18);
        l2Bridge.bridgeERC20To(address(l2Token), address(l3Token), alice, 100e18, 200_000);
        vm.stopPrank();

        assertEq(l2Token.balanceOf(address(l2Bridge)), 100e18, "not escrowed");
        assertEq(l2Bridge.deposits(address(l2Token), address(l3Token)), 100e18);

        // Derivation: kaurax-node turns TransactionDeposited into this L3 call, sent from
        // the aliased L2 bridge address.
        vm.prank(AddressAliasHelper.applyAlias(address(l2Bridge)));
        l3Bridge.finalizeDeposit(address(l2Token), address(l3Token), alice, alice, 100e18);

        assertEq(l3Token.balanceOf(alice), 100e18, "not minted on L3");
        assertEq(l3Token.totalSupply(), 100e18);
    }

    /// Without aliasing, an L2 contract could impersonate an L3 EOA. With it, only the
    /// derivation pipeline can produce a valid finalizeDeposit caller.
    function test_unaliasedSenderCannotFinalizeDeposit() public {
        vm.prank(address(l2Bridge));
        vm.expectRevert(KauraxL3ERC20Bridge.NotCounterpartBridge.selector);
        l3Bridge.finalizeDeposit(address(l2Token), address(l3Token), alice, alice, 1e18);

        vm.prank(alice);
        vm.expectRevert(KauraxL3ERC20Bridge.NotCounterpartBridge.selector);
        l3Bridge.finalizeDeposit(address(l2Token), address(l3Token), alice, alice, 1e18);
    }

    function test_mintIsBridgeOnly() public {
        vm.prank(alice);
        vm.expectRevert(KauraxBridgedERC20.NotBridge.selector);
        l3Token.mint(alice, 1e18);
    }

    function test_fullRoundTrip() public {
        // --- deposit ---
        vm.startPrank(alice);
        l2Token.approve(address(l2Bridge), 100e18);
        l2Bridge.bridgeERC20To(address(l2Token), address(l3Token), alice, 100e18, 200_000);
        vm.stopPrank();

        vm.prank(AddressAliasHelper.applyAlias(address(l2Bridge)));
        l3Bridge.finalizeDeposit(address(l2Token), address(l3Token), alice, alice, 100e18);

        // --- withdraw: burn on L3, emit a withdrawal message ---
        uint256 nonce = passer.messageNonce();
        bytes memory message = abi.encodeCall(
            KauraxL2ERC20Bridge.finalizeWithdrawal, (address(l2Token), address(l3Token), alice, alice, 40e18)
        );
        Types.WithdrawalTransaction memory wtx = Types.WithdrawalTransaction({
            nonce: nonce,
            sender: address(l3Bridge),
            target: address(l2Bridge),
            value: 0,
            gasLimit: 200_000,
            data: message
        });

        vm.prank(alice);
        l3Bridge.bridgeERC20To(address(l3Token), alice, 40e18, 200_000);

        assertEq(l3Token.balanceOf(alice), 60e18, "not burned on L3");
        leaves.push(Hashing.hashWithdrawal(wtx));

        // --- propose an output root over the withdrawal tree ---
        Types.OutputRootProof memory rp = Types.OutputRootProof({
            version: Hashing.OUTPUT_ROOT_VERSION,
            stateRoot: keccak256("state"),
            withdrawalTreeRoot: passer.withdrawalTreeRoot(),
            latestBlockHash: keccak256("block")
        });
        vm.prank(proposer);
        oracle.proposeL2Output(Hashing.hashOutputRoot(rp), 1, bytes32(0), 0);

        // --- prove and finalize on the L2 ---
        portal.proveWithdrawalTransaction(wtx, 0, rp, 0, MerkleHelper.proof(leaves, 0));
        vm.warp(block.timestamp + FINALIZATION + 1);

        uint256 aliceBefore = l2Token.balanceOf(alice);
        portal.finalizeWithdrawalTransaction(wtx);

        assertEq(l2Token.balanceOf(alice) - aliceBefore, 40e18, "escrow not released");
        assertEq(l2Bridge.deposits(address(l2Token), address(l3Token)), 60e18, "escrow accounting wrong");
    }

    /// The escrow release must be reachable only through the portal while it is
    /// finalizing a message from the counterpart bridge.
    function test_escrowCannotBeDrainedDirectly() public {
        vm.startPrank(alice);
        l2Token.approve(address(l2Bridge), 100e18);
        l2Bridge.bridgeERC20To(address(l2Token), address(l3Token), alice, 100e18, 200_000);
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(KauraxL2ERC20Bridge.NotPortal.selector);
        l2Bridge.finalizeWithdrawal(address(l2Token), address(l3Token), alice, alice, 100e18);

        // Even the portal cannot release escrow unless the L3 sender is the counterpart.
        vm.prank(address(portal));
        vm.expectRevert(KauraxL2ERC20Bridge.NotCounterpartBridge.selector);
        l2Bridge.finalizeWithdrawal(address(l2Token), address(l3Token), alice, alice, 100e18);
    }

    function test_tokenMismatchIsRejected() public {
        KauraxToken other = new KauraxToken("Other", "OTH", 18, 1e18);
        vm.prank(AddressAliasHelper.applyAlias(address(l2Bridge)));
        vm.expectRevert(KauraxL3ERC20Bridge.TokenMismatch.selector);
        l3Bridge.finalizeDeposit(address(other), address(l3Token), alice, alice, 1e18);
    }
}
