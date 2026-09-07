// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KauraxLaunchpad} from "../src/apps/KauraxLaunchpad.sol";
import {KauraxToken} from "../src/examples/KauraxToken.sol";

contract KauraxLaunchpadTest is Test {
    KauraxLaunchpad internal pad;
    KauraxToken internal token;

    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    // 1 KAX buys 1000 tokens.
    uint256 internal constant RATE = 1000e18;
    uint256 internal constant SOFT_CAP = 10 ether;
    uint256 internal constant HARD_CAP = 100 ether;
    uint256 internal constant FOR_SALE = 100_000e18; // exactly the hard cap's worth

    uint64 internal startsAt;
    uint64 internal endsAt;

    function setUp() public {
        vm.warp(1_700_000_000);
        pad = new KauraxLaunchpad();

        vm.prank(creator);
        token = new KauraxToken("Launch Token", "LNCH", 18, 1_000_000e18);

        startsAt = uint64(block.timestamp + 1 hours);
        endsAt = uint64(block.timestamp + 7 days);

        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
    }

    function _createAndFund() internal returns (uint256 saleId) {
        vm.startPrank(creator);
        saleId = pad.createSale(
            address(token),
            RATE,
            FOR_SALE,
            SOFT_CAP,
            HARD_CAP,
            0.1 ether,
            50 ether,
            startsAt,
            endsAt,
            "ipfs://sale"
        );
        token.approve(address(pad), FOR_SALE);
        pad.depositTokens(saleId);
        vm.stopPrank();
    }

    // ---------------------------------------------------------- creation --

    function test_createAndFund() public {
        uint256 id = _createAndFund();
        assertEq(uint256(pad.statusOf(id)), uint256(KauraxLaunchpad.Status.Funded));
        assertEq(token.balanceOf(address(pad)), FOR_SALE, "tokens not escrowed");
    }

    function test_statusIsPendingBeforeTokensAreDeposited() public {
        vm.prank(creator);
        uint256 id = pad.createSale(
            address(token),
            RATE,
            FOR_SALE,
            SOFT_CAP,
            HARD_CAP,
            0.1 ether,
            50 ether,
            startsAt,
            endsAt,
            "ipfs://x"
        );
        assertEq(uint256(pad.statusOf(id)), uint256(KauraxLaunchpad.Status.Pending));
    }

    /// A sale must not be able to raise KAX for tokens that were never escrowed.
    function test_cannotContributeBeforeTokensAreDeposited() public {
        vm.prank(creator);
        uint256 id = pad.createSale(
            address(token),
            RATE,
            FOR_SALE,
            SOFT_CAP,
            HARD_CAP,
            0.1 ether,
            50 ether,
            startsAt,
            endsAt,
            "ipfs://x"
        );
        vm.warp(startsAt + 1);

        vm.prank(alice);
        vm.expectRevert(KauraxLaunchpad.TokensNotDeposited.selector);
        pad.contribute{value: 1 ether}(id);
    }

    /// The escrow must cover the hard cap, or a late buyer pays for nothing.
    function test_rejectsAllocationTooSmallForTheHardCap() public {
        vm.prank(creator);
        vm.expectRevert(KauraxLaunchpad.InvalidCaps.selector);
        pad.createSale(
            address(token),
            RATE,
            1000e18,
            SOFT_CAP,
            HARD_CAP,
            0.1 ether,
            50 ether,
            startsAt,
            endsAt,
            "ipfs://x"
        );
    }

    function test_rejectsInvalidTimingAndCaps() public {
        vm.startPrank(creator);
        vm.expectRevert(KauraxLaunchpad.InvalidTiming.selector);
        pad.createSale(
            address(token),
            RATE,
            FOR_SALE,
            SOFT_CAP,
            HARD_CAP,
            0,
            50 ether,
            uint64(block.timestamp - 1),
            endsAt,
            ""
        );

        vm.expectRevert(KauraxLaunchpad.InvalidTiming.selector);
        pad.createSale(address(token), RATE, FOR_SALE, SOFT_CAP, HARD_CAP, 0, 50 ether, endsAt, startsAt, "");

        // Hard cap below soft cap.
        vm.expectRevert(KauraxLaunchpad.InvalidCaps.selector);
        pad.createSale(address(token), RATE, FOR_SALE, 100 ether, 10 ether, 0, 50 ether, startsAt, endsAt, "");
        vm.stopPrank();
    }

    function test_onlyCreatorMayDepositOrCancel() public {
        vm.prank(creator);
        uint256 id = pad.createSale(
            address(token), RATE, FOR_SALE, SOFT_CAP, HARD_CAP, 0.1 ether, 50 ether, startsAt, endsAt, ""
        );

        vm.startPrank(alice);
        vm.expectRevert(KauraxLaunchpad.NotCreator.selector);
        pad.depositTokens(id);
        vm.expectRevert(KauraxLaunchpad.NotCreator.selector);
        pad.cancelSale(id);
        vm.stopPrank();
    }

    function test_cancelBeforeStartReturnsTokens() public {
        uint256 id = _createAndFund();
        uint256 before = token.balanceOf(creator);

        vm.prank(creator);
        pad.cancelSale(id);

        assertEq(token.balanceOf(creator) - before, FOR_SALE, "escrow not returned");
        assertEq(uint256(pad.statusOf(id)), uint256(KauraxLaunchpad.Status.Cancelled));
    }

    function test_cannotCancelOnceStarted() public {
        uint256 id = _createAndFund();
        vm.warp(startsAt + 1);

        vm.prank(creator);
        vm.expectRevert(KauraxLaunchpad.SaleAlreadyStarted.selector);
        pad.cancelSale(id);
    }

    // ----------------------------------------------------- participation --

    function test_contributeRecordsAllocation() public {
        uint256 id = _createAndFund();
        vm.warp(startsAt + 1);

        vm.prank(alice);
        pad.contribute{value: 5 ether}(id);

        assertEq(pad.contributionOf(id, alice), 5 ether);
        assertEq(pad.allocationOf(id, alice), 5000e18, "allocation miscalculated");
        assertEq(uint256(pad.statusOf(id)), uint256(KauraxLaunchpad.Status.Live));
    }

    function test_rejectsContributionOutsideTheWindow() public {
        uint256 id = _createAndFund();

        vm.prank(alice);
        vm.expectRevert(KauraxLaunchpad.SaleNotLive.selector);
        pad.contribute{value: 1 ether}(id);

        vm.warp(endsAt + 1);
        vm.prank(alice);
        vm.expectRevert(KauraxLaunchpad.SaleNotLive.selector);
        pad.contribute{value: 1 ether}(id);
    }

    function test_enforcesMinAndMaxContribution() public {
        uint256 id = _createAndFund();
        vm.warp(startsAt + 1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KauraxLaunchpad.ContributionTooSmall.selector, 0.1 ether));
        pad.contribute{value: 0.05 ether}(id);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KauraxLaunchpad.ContributionTooLarge.selector, 50 ether));
        pad.contribute{value: 51 ether}(id);
    }

    /// The per-buyer cap must apply to the cumulative total, not each transaction.
    function test_maxContributionIsCumulative() public {
        uint256 id = _createAndFund();
        vm.warp(startsAt + 1);

        vm.startPrank(alice);
        pad.contribute{value: 30 ether}(id);
        vm.expectRevert(abi.encodeWithSelector(KauraxLaunchpad.ContributionTooLarge.selector, 50 ether));
        pad.contribute{value: 25 ether}(id);
        vm.stopPrank();
    }

    function test_enforcesHardCap() public {
        uint256 id = _createAndFund();
        vm.warp(startsAt + 1);

        vm.prank(alice);
        pad.contribute{value: 50 ether}(id);
        vm.prank(bob);
        pad.contribute{value: 50 ether}(id);

        address carol = makeAddr("carol");
        vm.deal(carol, 10 ether);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(KauraxLaunchpad.HardCapExceeded.selector, 0));
        pad.contribute{value: 1 ether}(id);
    }

    // ------------------------------------------------------- successful --

    function test_successfulSaleEndToEnd() public {
        uint256 id = _createAndFund();
        vm.warp(startsAt + 1);

        vm.prank(alice);
        pad.contribute{value: 20 ether}(id);
        vm.prank(bob);
        pad.contribute{value: 10 ether}(id);

        vm.warp(endsAt + 1);
        pad.finalise(id);
        assertEq(uint256(pad.statusOf(id)), uint256(KauraxLaunchpad.Status.Succeeded));

        // Unsold tokens go back to the creator at finalisation.
        assertEq(token.balanceOf(creator), 1_000_000e18 - FOR_SALE + (FOR_SALE - 30_000e18));

        vm.prank(alice);
        pad.claimTokens(id);
        assertEq(token.balanceOf(alice), 20_000e18);

        vm.prank(bob);
        pad.claimTokens(id);
        assertEq(token.balanceOf(bob), 10_000e18);

        uint256 beforeKax = creator.balance;
        vm.prank(creator);
        pad.withdrawRaise(id);
        assertEq(creator.balance - beforeKax, 30 ether, "creator did not receive the raise");
    }

    function test_cannotClaimTwice() public {
        uint256 id = _createAndFund();
        vm.warp(startsAt + 1);
        vm.prank(alice);
        pad.contribute{value: 20 ether}(id);
        vm.warp(endsAt + 1);
        pad.finalise(id);

        vm.startPrank(alice);
        pad.claimTokens(id);
        vm.expectRevert(KauraxLaunchpad.AlreadyClaimed.selector);
        pad.claimTokens(id);
        vm.stopPrank();
    }

    function test_creatorCannotWithdrawTwice() public {
        uint256 id = _createAndFund();
        vm.warp(startsAt + 1);
        vm.prank(alice);
        pad.contribute{value: 20 ether}(id);
        vm.warp(endsAt + 1);
        pad.finalise(id);

        vm.startPrank(creator);
        pad.withdrawRaise(id);
        vm.expectRevert(KauraxLaunchpad.AlreadyPaid.selector);
        pad.withdrawRaise(id);
        vm.stopPrank();
    }

    /// The creator must not be able to take the KAX while buyers are still committed.
    function test_creatorCannotWithdrawBeforeFinalisation() public {
        uint256 id = _createAndFund();
        vm.warp(startsAt + 1);
        vm.prank(alice);
        pad.contribute{value: 20 ether}(id);

        vm.prank(creator);
        vm.expectRevert(KauraxLaunchpad.NotFinalised.selector);
        pad.withdrawRaise(id);
    }

    function test_canFinaliseEarlyOnceHardCapIsReached() public {
        uint256 id = _createAndFund();
        vm.warp(startsAt + 1);

        vm.prank(alice);
        pad.contribute{value: 50 ether}(id);
        vm.prank(bob);
        pad.contribute{value: 50 ether}(id);

        // Still inside the window, but the outcome can no longer change.
        pad.finalise(id);
        assertEq(uint256(pad.statusOf(id)), uint256(KauraxLaunchpad.Status.Succeeded));
    }

    // ----------------------------------------------------------- failed --

    function test_failedSaleRefundsEveryone() public {
        uint256 id = _createAndFund();
        vm.warp(startsAt + 1);

        // Below the 10 KAX soft cap.
        vm.prank(alice);
        pad.contribute{value: 3 ether}(id);
        vm.prank(bob);
        pad.contribute{value: 2 ether}(id);

        vm.warp(endsAt + 1);
        pad.finalise(id);
        assertEq(uint256(pad.statusOf(id)), uint256(KauraxLaunchpad.Status.Failed));

        // The full allocation returns to the creator.
        assertEq(token.balanceOf(creator), 1_000_000e18, "escrow not fully returned");

        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        pad.refund(id);
        assertEq(alice.balance - aliceBefore, 3 ether);

        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        pad.refund(id);
        assertEq(bob.balance - bobBefore, 2 ether);

        assertEq(address(pad).balance, 0, "KAX left stranded in the launchpad");
    }

    function test_creatorGetsNothingFromAFailedSale() public {
        uint256 id = _createAndFund();
        vm.warp(startsAt + 1);
        vm.prank(alice);
        pad.contribute{value: 3 ether}(id);
        vm.warp(endsAt + 1);
        pad.finalise(id);

        vm.prank(creator);
        vm.expectRevert(KauraxLaunchpad.SaleFailedSoNoTokens.selector);
        pad.withdrawRaise(id);
    }

    function test_noTokensFromAFailedSale() public {
        uint256 id = _createAndFund();
        vm.warp(startsAt + 1);
        vm.prank(alice);
        pad.contribute{value: 3 ether}(id);
        vm.warp(endsAt + 1);
        pad.finalise(id);

        vm.prank(alice);
        vm.expectRevert(KauraxLaunchpad.SaleFailedSoNoTokens.selector);
        pad.claimTokens(id);
    }

    function test_noRefundFromASuccessfulSale() public {
        uint256 id = _createAndFund();
        vm.warp(startsAt + 1);
        vm.prank(alice);
        pad.contribute{value: 20 ether}(id);
        vm.warp(endsAt + 1);
        pad.finalise(id);

        vm.prank(alice);
        vm.expectRevert(KauraxLaunchpad.SaleSucceededSoNoRefund.selector);
        pad.refund(id);
    }

    function test_cannotRefundTwice() public {
        uint256 id = _createAndFund();
        vm.warp(startsAt + 1);
        vm.prank(alice);
        pad.contribute{value: 3 ether}(id);
        vm.warp(endsAt + 1);
        pad.finalise(id);

        vm.startPrank(alice);
        pad.refund(id);
        vm.expectRevert(KauraxLaunchpad.AlreadyClaimed.selector);
        pad.refund(id);
        vm.stopPrank();
    }

    /// Finalisation is permissionless so an absent creator cannot strand refunds.
    function test_anyoneMayFinalise() public {
        uint256 id = _createAndFund();
        vm.warp(startsAt + 1);
        vm.prank(alice);
        pad.contribute{value: 3 ether}(id);
        vm.warp(endsAt + 1);

        vm.prank(bob);
        pad.finalise(id);
        assertEq(uint256(pad.statusOf(id)), uint256(KauraxLaunchpad.Status.Failed));
    }

    function test_cannotFinaliseTwice() public {
        uint256 id = _createAndFund();
        vm.warp(endsAt + 1);
        pad.finalise(id);
        vm.expectRevert(KauraxLaunchpad.AlreadyFinalised.selector);
        pad.finalise(id);
    }

    // ------------------------------------------------------------- fuzz --

    /// Whatever the contributions, the launchpad must end up holding no KAX once everyone
    /// has settled: either the creator took the raise, or every buyer refunded.
    function testFuzz_launchpadRetainsNoKax(uint96 rawA, uint96 rawB) public {
        uint256 a = bound(uint256(rawA), 0.1 ether, 50 ether);
        uint256 b = bound(uint256(rawB), 0.1 ether, 50 ether);

        uint256 id = _createAndFund();
        vm.warp(startsAt + 1);

        vm.prank(alice);
        pad.contribute{value: a}(id);
        vm.prank(bob);
        pad.contribute{value: b}(id);

        vm.warp(endsAt + 1);
        pad.finalise(id);

        if (a + b >= SOFT_CAP) {
            vm.prank(creator);
            pad.withdrawRaise(id);
        } else {
            vm.prank(alice);
            pad.refund(id);
            vm.prank(bob);
            pad.refund(id);
        }

        assertEq(address(pad).balance, 0, "KAX stranded in the launchpad");
    }

    function testFuzz_allocationMatchesContribution(uint96 raw) public {
        uint256 amount = bound(uint256(raw), 0.1 ether, 50 ether);
        uint256 id = _createAndFund();
        vm.warp(startsAt + 1);

        vm.prank(alice);
        pad.contribute{value: amount}(id);

        assertEq(pad.allocationOf(id, alice), (amount * RATE) / 1e18);
    }
}
