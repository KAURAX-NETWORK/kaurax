// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KauraxMultisig} from "../src/governance/KauraxMultisig.sol";

/// @dev A payee that tries to re-enter the treasury while being paid.
contract ReentrantPayee {
    KauraxMultisig internal immutable TREASURY;
    uint256 internal immutable TX_ID;
    bool public reentered;
    bool public reentrySucceeded;

    constructor(KauraxMultisig treasury_, uint256 txId_) {
        TREASURY = treasury_;
        TX_ID = txId_;
    }

    receive() external payable {
        if (reentered) return;
        reentered = true;
        // Re-enter and try to be paid a second time from the same approved proposal.
        try TREASURY.execute(TX_ID) {
            reentrySucceeded = true;
        } catch {
            reentrySucceeded = false;
        }
    }
}

/// @dev A payee that refuses payment, so a disbursement to it cannot settle.
contract RejectingPayee {
    receive() external payable {
        revert("no thanks");
    }
}

/// @title The KAURAX treasury, which is a KauraxMultisig holding protocol fees.
///
/// @notice `Governance.t.sol` covers the multisig as a governance instrument — roles,
///         epochs, owner management. This file covers it as a **treasury**: an account
///         that native KAX accrues into and leaves from. The two have different failure
///         modes, and the ones that matter here are about money.
///
/// @dev The single most important fact these tests pin is how the treasury is funded.
///      Gas fees arrive as a **coinbase credit**, which is a direct balance increase in
///      the state trie — the EVM does not call the account. So `receive()` never runs and
///      no `Deposit` event is emitted for fee income. That was verified against a real
///      `anvil` block before these tests were written: with the treasury set as coinbase,
///      a 21,000-gas transfer at a 2 gwei priority fee raised its balance by exactly
///      42,000,000,000,000 wei and emitted nothing.
///
///      `vm.deal` is used below precisely because it models that: it moves the balance
///      without calling the account, which is what a coinbase credit does and what a
///      plain `payable` transfer does not.
///
///      The consequence is documented rather than worked around: an indexer watching
///      `Deposit` would report zero fee income forever. See docs/TREASURY_POLICY.md.
contract TreasuryTest is Test {
    KauraxMultisig internal treasury;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal mallory = makeAddr("mallory");
    address internal payee = makeAddr("payee");

    function setUp() public {
        address[] memory owners = new address[](3);
        owners[0] = alice;
        owners[1] = bob;
        owners[2] = carol;
        treasury = new KauraxMultisig(owners, 2);
    }

    /// @dev Fund the treasury the way the protocol does: a balance credit, no call.
    function _accrueFees(uint256 amount) internal {
        vm.deal(address(treasury), address(treasury).balance + amount);
    }

    // ---------------------------------------------------------------- //
    //                            Accrual                               //
    // ---------------------------------------------------------------- //

    function test_accruesFeesWithoutBeingCalled() public {
        assertEq(address(treasury).balance, 0);
        _accrueFees(42_000_000_000_000);
        // The figure measured on a real anvil block for one 21,000-gas transfer at a
        // 2 gwei priority fee.
        assertEq(address(treasury).balance, 42_000_000_000_000);
    }

    function test_feeIncomeEmitsNoDepositEvent() public {
        // The gap that would mislead an indexer: fee income is invisible to `Deposit`.
        vm.recordLogs();
        _accrueFees(1 ether);
        assertEq(vm.getRecordedLogs().length, 0, "a coinbase credit must not emit a log");
    }

    function test_ordinaryTransferDoesEmitDeposit() public {
        // By contrast, an actual send DOES call receive(). Both paths credit the same
        // balance, so a reader cannot infer income from events alone.
        vm.deal(alice, 1 ether);
        vm.expectEmit(true, false, false, true, address(treasury));
        emit KauraxMultisig.Deposit(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(treasury).call{value: 1 ether}("");
        assertTrue(ok);
    }

    // ---------------------------------------------------------------- //
    //                     Unauthorised withdrawal                      //
    // ---------------------------------------------------------------- //

    function test_nonOwnerCannotProposeADisbursement() public {
        _accrueFees(10 ether);
        vm.prank(mallory);
        vm.expectRevert(KauraxMultisig.NotOwner.selector);
        treasury.submit(mallory, 10 ether, "", "drain");
    }

    function test_nonOwnerCannotExecuteAConfirmedDisbursement() public {
        _accrueFees(10 ether);
        vm.prank(alice);
        uint256 id = treasury.submit(payee, 1 ether, "", "grant");
        vm.prank(bob);
        treasury.confirm(id);

        // Fully confirmed, but execution is still owners-only.
        assertTrue(treasury.isExecutable(id));
        vm.prank(mallory);
        vm.expectRevert(KauraxMultisig.NotOwner.selector);
        treasury.execute(id);
    }

    function test_oneOwnerCannotDisburseAlone() public {
        _accrueFees(10 ether);
        vm.startPrank(alice);
        uint256 id = treasury.submit(payee, 1 ether, "", "grant");
        // submit() self-confirms, so this is 1 of the 2 required.
        vm.expectRevert(abi.encodeWithSelector(KauraxMultisig.NotEnoughConfirmations.selector, 1, 2));
        treasury.execute(id);
        vm.stopPrank();

        assertEq(payee.balance, 0);
        assertEq(address(treasury).balance, 10 ether);
    }

    function test_theSameOwnerCannotConfirmTwiceToReachTheThreshold() public {
        _accrueFees(10 ether);
        vm.startPrank(alice);
        uint256 id = treasury.submit(payee, 1 ether, "", "grant");
        vm.expectRevert(KauraxMultisig.AlreadyConfirmed.selector);
        treasury.confirm(id);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- //
    //                        The happy path                            //
    // ---------------------------------------------------------------- //

    function test_twoOfThreeDisburses() public {
        _accrueFees(10 ether);

        vm.prank(alice);
        uint256 id = treasury.submit(payee, 3 ether, "", "Q1 infrastructure reimbursement");
        vm.prank(bob);
        treasury.confirm(id);
        vm.prank(bob);
        treasury.execute(id);

        assertEq(payee.balance, 3 ether);
        assertEq(address(treasury).balance, 7 ether);

        (,,, bool executed,,, string memory description) = treasury.getTransaction(id);
        assertTrue(executed);
        // The reason is on chain, which is the whole point of a transparent treasury.
        assertEq(description, "Q1 infrastructure reimbursement");
    }

    function test_aDisbursementCannotBeExecutedTwice() public {
        _accrueFees(10 ether);
        vm.prank(alice);
        uint256 id = treasury.submit(payee, 3 ether, "", "grant");
        vm.prank(bob);
        treasury.confirm(id);
        vm.prank(bob);
        treasury.execute(id);

        vm.prank(alice);
        vm.expectRevert(KauraxMultisig.AlreadyExecuted.selector);
        treasury.execute(id);
        assertEq(payee.balance, 3 ether);
    }

    // ---------------------------------------------------------------- //
    //                           Reentrancy                             //
    // ---------------------------------------------------------------- //

    function test_payeeCannotReenterToBePaidTwice() public {
        _accrueFees(10 ether);

        // txId 0 is the proposal the payee will try to re-execute from inside its receive().
        ReentrantPayee attacker = new ReentrantPayee(treasury, 0);

        vm.prank(alice);
        uint256 id = treasury.submit(address(attacker), 1 ether, "", "grant");
        assertEq(id, 0, "the attacker was constructed against txId 0");
        vm.prank(bob);
        treasury.confirm(id);
        vm.prank(bob);
        treasury.execute(id);

        assertTrue(attacker.reentered(), "the attacker should have been given the chance");
        assertFalse(attacker.reentrySucceeded(), "reentry must not pay twice");
        // Paid exactly once. `executed` is set before the call, so the reentrant attempt
        // finds it already true.
        assertEq(address(attacker).balance, 1 ether);
        assertEq(address(treasury).balance, 9 ether);
    }

    // ---------------------------------------------------------------- //
    //                   Membership changes mid-flight                  //
    // ---------------------------------------------------------------- //

    function test_removingAnOwnerInvalidatesAPendingDisbursement() public {
        _accrueFees(10 ether);

        vm.prank(alice);
        uint256 payment = treasury.submit(payee, 5 ether, "", "pending grant");

        // Rotate the owner set through the multisig itself.
        bytes memory removal = abi.encodeCall(KauraxMultisig.removeOwner, (carol));
        vm.prank(alice);
        uint256 rotate = treasury.submit(address(treasury), 0, removal, "remove carol");
        vm.prank(bob);
        treasury.confirm(rotate);
        vm.prank(bob);
        treasury.execute(rotate);

        // The pending payment was confirmed under the previous owner set.
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(KauraxMultisig.StaleProposal.selector, 0, 1));
        treasury.confirm(payment);

        assertEq(payee.balance, 0);
        assertEq(address(treasury).balance, 10 ether);
    }

    function test_aRemovedOwnerCannotDisburse() public {
        _accrueFees(10 ether);

        bytes memory removal = abi.encodeCall(KauraxMultisig.removeOwner, (carol));
        vm.prank(alice);
        uint256 rotate = treasury.submit(address(treasury), 0, removal, "remove carol");
        vm.prank(bob);
        treasury.confirm(rotate);
        vm.prank(bob);
        treasury.execute(rotate);

        vm.prank(carol);
        vm.expectRevert(KauraxMultisig.NotOwner.selector);
        treasury.submit(carol, 1 ether, "", "severance");
    }

    // ---------------------------------------------------------------- //
    //                    Boundaries and trapped funds                  //
    // ---------------------------------------------------------------- //

    function test_theEntireBalanceCanBeDisbursed() public {
        // Funds must never be trappable: whatever accrues must be able to leave.
        _accrueFees(10 ether);

        vm.prank(alice);
        uint256 id = treasury.submit(payee, 10 ether, "", "full sweep");
        vm.prank(bob);
        treasury.confirm(id);
        vm.prank(bob);
        treasury.execute(id);

        assertEq(address(treasury).balance, 0);
        assertEq(payee.balance, 10 ether);
    }

    function test_disbursingMoreThanTheBalanceRevertsAndChangesNothing() public {
        _accrueFees(1 ether);

        vm.prank(alice);
        uint256 id = treasury.submit(payee, 2 ether, "", "overdraft");
        vm.prank(bob);
        treasury.confirm(id);

        vm.prank(bob);
        vm.expectRevert(KauraxMultisig.ExecutionReverted.selector);
        treasury.execute(id);

        assertEq(address(treasury).balance, 1 ether);
        assertEq(payee.balance, 0);
    }

    function test_aFailedDisbursementCanBeRetriedAfterTheCauseIsFixed() public {
        // The proposal is marked executed before the call, but the whole execute()
        // reverts on failure, so that write is rolled back and the proposal survives.
        _accrueFees(1 ether);

        vm.prank(alice);
        uint256 id = treasury.submit(payee, 2 ether, "", "exceeds the current balance");
        vm.prank(bob);
        treasury.confirm(id);
        vm.prank(bob);
        vm.expectRevert(KauraxMultisig.ExecutionReverted.selector);
        treasury.execute(id);

        // More fees accrue; the same proposal now settles.
        _accrueFees(5 ether);
        vm.prank(bob);
        treasury.execute(id);
        assertEq(payee.balance, 2 ether);
    }

    function test_aPayeeThatRejectsPaymentCannotStrandTheTreasury() public {
        _accrueFees(10 ether);
        RejectingPayee rejecting = new RejectingPayee();

        vm.prank(alice);
        uint256 bad = treasury.submit(address(rejecting), 1 ether, "", "will be refused");
        vm.prank(bob);
        treasury.confirm(bad);
        vm.prank(bob);
        vm.expectRevert(KauraxMultisig.ExecutionReverted.selector);
        treasury.execute(bad);

        // The treasury is untouched and still able to pay someone else.
        vm.prank(alice);
        uint256 good = treasury.submit(payee, 1 ether, "", "a payee that accepts");
        vm.prank(bob);
        treasury.confirm(good);
        vm.prank(bob);
        treasury.execute(good);
        assertEq(payee.balance, 1 ether);
    }

    function test_aZeroValueProposalIsAllowed() public {
        // Governance actions (owner rotation) are zero-value, so this must work.
        vm.prank(alice);
        uint256 id = treasury.submit(payee, 0, "", "no-op");
        vm.prank(bob);
        treasury.confirm(id);
        vm.prank(bob);
        treasury.execute(id);
        assertEq(payee.balance, 0);
    }

    function test_disbursementToTheZeroAddressIsRejectedAtProposalTime() public {
        _accrueFees(1 ether);
        vm.prank(alice);
        vm.expectRevert(KauraxMultisig.ZeroAddress.selector);
        treasury.submit(address(0), 1 ether, "", "burn");
    }

    // ---------------------------------------------------------------- //
    //                      Accounting over time                        //
    // ---------------------------------------------------------------- //

    function testFuzz_balanceIsAccrualsMinusDisbursements(uint96 a, uint96 b, uint96 spend) public {
        uint256 accrued = uint256(a) + uint256(b);
        vm.assume(spend <= accrued && spend > 0);

        _accrueFees(a);
        _accrueFees(b);
        assertEq(address(treasury).balance, accrued);

        vm.prank(alice);
        uint256 id = treasury.submit(payee, spend, "", "fuzzed disbursement");
        vm.prank(bob);
        treasury.confirm(id);
        vm.prank(bob);
        treasury.execute(id);

        assertEq(address(treasury).balance, accrued - spend);
        assertEq(payee.balance, spend);
    }

    function test_revokingAConfirmationStopsADisbursement() public {
        _accrueFees(10 ether);

        vm.prank(alice);
        uint256 id = treasury.submit(payee, 1 ether, "", "grant");
        vm.prank(bob);
        treasury.confirm(id);
        assertTrue(treasury.isExecutable(id));

        // An owner who changes their mind before execution can withdraw consent.
        vm.prank(bob);
        treasury.revokeConfirmation(id);
        assertFalse(treasury.isExecutable(id));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KauraxMultisig.NotEnoughConfirmations.selector, 1, 2));
        treasury.execute(id);
        assertEq(payee.balance, 0);
    }
}
