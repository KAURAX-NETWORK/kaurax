// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KauraxNames} from "../src/apps/KauraxNames.sol";

contract Rejector {
    receive() external payable {
        revert("no");
    }
}

contract KauraxNamesTest is Test {
    KauraxNames internal names;

    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant P3 = 1 ether;
    uint256 internal constant P4 = 0.3 ether;
    uint256 internal constant P5 = 0.05 ether;
    uint64 internal constant YEAR = 365 days;

    function setUp() public {
        vm.warp(1_700_000_000);
        names = new KauraxNames(treasury, P3, P4, P5);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    // ------------------------------------------------------- validation --

    function test_acceptsValidLabels() public view {
        assertTrue(names.isValidLabel("abc"));
        assertTrue(names.isValidLabel("kaurax"));
        assertTrue(names.isValidLabel("my-name-123"));
        assertTrue(names.isValidLabel("a1b"));
    }

    function test_rejectsInvalidLabels() public view {
        assertFalse(names.isValidLabel("ab"), "too short");
        assertFalse(names.isValidLabel("-abc"), "leading hyphen");
        assertFalse(names.isValidLabel("abc-"), "trailing hyphen");
        assertFalse(names.isValidLabel("ABC"), "uppercase");
        assertFalse(names.isValidLabel("a b"), "space");
        assertFalse(names.isValidLabel("a.b"), "dot");
        assertFalse(names.isValidLabel(unicode"καυραξ"), "greek");
        assertFalse(names.isValidLabel(unicode"kaurax\u00e9"), "accented latin");
        assertFalse(names.isValidLabel(unicode"kaurax\u2011name"), "unicode hyphen lookalike");
        assertFalse(names.isValidLabel(""), "empty");
    }

    /// Uppercase is rejected rather than lowercased: folding would make two different
    /// inputs resolve to the same name, which is a phishing surface.
    function test_uppercaseIsRejectedNotFolded() public {
        vm.prank(alice);
        vm.expectRevert(KauraxNames.InvalidLabel.selector);
        names.register{value: 1 ether}("Alice", YEAR);
    }

    function test_rejectsLabelOver63Chars() public view {
        string memory long = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 65
        assertFalse(names.isValidLabel(long));
    }

    // ----------------------------------------------------------- pricing --

    function test_priceScalesWithLengthAndDuration() public view {
        assertEq(names.priceFor("abc", YEAR), P3);
        assertEq(names.priceFor("abcd", YEAR), P4);
        assertEq(names.priceFor("abcde", YEAR), P5);
        assertEq(names.priceFor("abcdefghij", YEAR), P5, "5+ is one tier");
        assertEq(names.priceFor("abcde", YEAR * 2), P5 * 2);
        assertEq(names.priceFor("abcde", YEAR / 2), P5 / 2);
    }

    // ------------------------------------------------------ registration --

    function test_registerStoresRecordAndPaysTreasury() public {
        uint256 before = treasury.balance;

        vm.prank(alice);
        names.register{value: P5}("kaurax", YEAR);

        assertEq(names.resolve("kaurax"), alice);
        assertEq(names.ownerOf("kaurax"), alice);
        assertEq(treasury.balance - before, P5, "treasury not paid");
        assertEq(names.totalRegistrations(), 1);
    }

    function test_refundsOverpayment() public {
        uint256 before = alice.balance;

        vm.prank(alice);
        names.register{value: 5 ether}("kaurax", YEAR);

        assertEq(before - alice.balance, P5, "overpayment not refunded");
    }

    function test_rejectsUnderpayment() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KauraxNames.InsufficientPayment.selector, P5, P5 - 1));
        names.register{value: P5 - 1}("kaurax", YEAR);
    }

    function test_cannotRegisterATakenName() public {
        vm.prank(alice);
        names.register{value: P5}("kaurax", YEAR);

        vm.prank(bob);
        vm.expectRevert(KauraxNames.NameNotAvailable.selector);
        names.register{value: P5}("kaurax", YEAR);
    }

    function test_rejectsDurationOutOfRange() public {
        vm.startPrank(alice);
        vm.expectRevert(KauraxNames.InvalidDuration.selector);
        names.register{value: 10 ether}("kaurax", 1 days);

        vm.expectRevert(KauraxNames.InvalidDuration.selector);
        names.register{value: 10 ether}("kaurax", 4000 days);
        vm.stopPrank();
    }

    // ----------------------------------------------------------- expiry --

    function test_expiredNameStopsResolving() public {
        vm.prank(alice);
        names.register{value: P5}("kaurax", YEAR);

        vm.warp(block.timestamp + YEAR + 1);
        assertEq(names.resolve("kaurax"), address(0), "expired name still resolves");
    }

    /// During the grace period the name is not resolvable but is also not available: a
    /// missed renewal must be recoverable rather than instantly lost to a sniper.
    function test_gracePeriodBlocksOthersButAllowsRenewal() public {
        vm.prank(alice);
        names.register{value: P5}("kaurax", YEAR);

        vm.warp(block.timestamp + YEAR + 1 days);

        assertFalse(names.isAvailable("kaurax"), "available during grace");
        assertEq(names.ownerOf("kaurax"), alice, "owner lost during grace");

        vm.prank(bob);
        vm.expectRevert(KauraxNames.NameNotAvailable.selector);
        names.register{value: P5}("kaurax", YEAR);

        vm.prank(alice);
        names.renew{value: P5}("kaurax", YEAR);
        assertEq(names.resolve("kaurax"), alice, "renewal did not restore the name");
    }

    function test_availableAfterGracePeriod() public {
        vm.prank(alice);
        names.register{value: P5}("kaurax", YEAR);

        vm.warp(block.timestamp + YEAR + names.GRACE_PERIOD() + 1);
        assertTrue(names.isAvailable("kaurax"));

        vm.prank(bob);
        names.register{value: P5}("kaurax", YEAR);
        assertEq(names.resolve("kaurax"), bob);
    }

    /// A lapsed name must not receive free time: renewal extends from now, not from the
    /// old expiry, once it has already passed.
    function test_renewalAfterExpiryExtendsFromNow() public {
        vm.prank(alice);
        names.register{value: P5}("kaurax", YEAR);
        uint64 originalExpiry = uint64(block.timestamp) + YEAR;

        vm.warp(block.timestamp + YEAR + 10 days);
        vm.prank(alice);
        names.renew{value: P5}("kaurax", YEAR);

        (,, uint64 expiresAt,,) = names.recordOf("kaurax");
        assertEq(expiresAt, uint64(block.timestamp) + YEAR);
        assertGt(expiresAt, originalExpiry + YEAR - 1 days, "sanity");
    }

    function test_renewalBeforeExpiryExtendsFromExpiry() public {
        vm.prank(alice);
        names.register{value: P5}("kaurax", YEAR);
        uint64 originalExpiry = uint64(block.timestamp) + YEAR;

        vm.warp(block.timestamp + 100 days);
        vm.prank(alice);
        names.renew{value: P5}("kaurax", YEAR);

        (,, uint64 expiresAt,,) = names.recordOf("kaurax");
        assertEq(expiresAt, originalExpiry + YEAR, "time was lost on early renewal");
    }

    function test_anyoneMayRenewSomeoneElsesName() public {
        vm.prank(alice);
        names.register{value: P5}("kaurax", YEAR);

        vm.prank(bob);
        names.renew{value: P5}("kaurax", YEAR);

        assertEq(names.ownerOf("kaurax"), alice, "renewal transferred ownership");
    }

    function test_cannotRenewAfterGracePeriod() public {
        vm.prank(alice);
        names.register{value: P5}("kaurax", YEAR);

        vm.warp(block.timestamp + YEAR + names.GRACE_PERIOD() + 1);
        vm.prank(alice);
        vm.expectRevert(KauraxNames.NameNotRegistered.selector);
        names.renew{value: P5}("kaurax", YEAR);
    }

    // --------------------------------------------------------- control --

    function test_ownerCanRepointAndTransfer() public {
        vm.startPrank(alice);
        names.register{value: P5}("kaurax", YEAR);

        names.setResolvedAddress("kaurax", bob);
        assertEq(names.resolve("kaurax"), bob, "resolution not updated");
        assertEq(names.ownerOf("kaurax"), alice, "ownership changed unexpectedly");

        names.transferName("kaurax", bob);
        vm.stopPrank();

        assertEq(names.ownerOf("kaurax"), bob);
    }

    function test_onlyOwnerMayRepointOrTransfer() public {
        vm.prank(alice);
        names.register{value: P5}("kaurax", YEAR);

        vm.startPrank(bob);
        vm.expectRevert(KauraxNames.NotNameOwner.selector);
        names.setResolvedAddress("kaurax", bob);

        vm.expectRevert(KauraxNames.NotNameOwner.selector);
        names.transferName("kaurax", bob);
        vm.stopPrank();
    }

    // ---------------------------------------------------- primary name --

    function test_primaryNameRequiresResolution() public {
        vm.prank(alice);
        names.register{value: P5}("kaurax", YEAR);

        vm.prank(alice);
        names.setPrimaryName("kaurax");
        assertEq(names.primaryName(alice), "kaurax");
    }

    /// The property that matters: nobody can point a name at your address and make it
    /// display as yours.
    function test_cannotClaimANameResolvingToSomeoneElse() public {
        vm.prank(alice);
        names.register{value: P5}("kaurax", YEAR);

        vm.prank(bob);
        vm.expectRevert(KauraxNames.NotResolvedAddress.selector);
        names.setPrimaryName("kaurax");
    }

    function test_primaryNameClearsWhenRepointedAway() public {
        vm.startPrank(alice);
        names.register{value: P5}("kaurax", YEAR);
        names.setPrimaryName("kaurax");
        assertEq(names.primaryName(alice), "kaurax");

        names.setResolvedAddress("kaurax", bob);
        vm.stopPrank();

        assertEq(names.primaryName(alice), "", "stale primary name still displayed");
    }

    function test_primaryNameClearsOnExpiry() public {
        vm.startPrank(alice);
        names.register{value: P5}("kaurax", YEAR);
        names.setPrimaryName("kaurax");
        vm.stopPrank();

        vm.warp(block.timestamp + YEAR + 1);
        assertEq(names.primaryName(alice), "", "expired name still displayed");
    }

    function test_transferClearsPreviousOwnersPrimaryName() public {
        vm.startPrank(alice);
        names.register{value: P5}("kaurax", YEAR);
        names.setPrimaryName("kaurax");
        names.transferName("kaurax", bob);
        vm.stopPrank();

        assertEq(names.primaryName(alice), "", "primary name survived transfer");
    }

    function test_clearPrimaryName() public {
        vm.startPrank(alice);
        names.register{value: P5}("kaurax", YEAR);
        names.setPrimaryName("kaurax");
        names.clearPrimaryName();
        vm.stopPrank();
        assertEq(names.primaryName(alice), "");
    }

    // ------------------------------------------------------------ admin --

    function test_onlyOwnerMayChangeTreasury() public {
        vm.prank(alice);
        vm.expectRevert(KauraxNames.NotOwner.selector);
        names.setTreasury(alice);

        names.setTreasury(bob);
        assertEq(names.treasury(), bob);
    }

    /// A treasury that cannot receive value must fail the registration loudly rather than
    /// silently keeping the fee in the contract.
    function test_registrationFailsIfTreasuryRejectsPayment() public {
        Rejector bad = new Rejector();
        names.setTreasury(address(bad));

        vm.prank(alice);
        vm.expectRevert(KauraxNames.PaymentFailed.selector);
        names.register{value: P5}("kaurax", YEAR);
    }

    // ------------------------------------------------------------ fuzz --

    function testFuzz_registerThenResolve(address who, uint64 duration) public {
        vm.assume(who != address(0) && who.code.length == 0);
        duration = uint64(bound(duration, names.MIN_DURATION(), names.MAX_DURATION()));

        uint256 price = names.priceFor("fuzzname", duration);
        vm.deal(who, price + 1 ether);

        vm.prank(who);
        names.register{value: price}("fuzzname", duration);

        assertEq(names.resolve("fuzzname"), who);
        assertEq(names.ownerOf("fuzzname"), who);
    }

    function testFuzz_priceIsProportionalToDuration(uint64 duration) public view {
        duration = uint64(bound(duration, names.MIN_DURATION(), names.MAX_DURATION()));
        assertEq(names.priceFor("kaurax", duration), (P5 * duration) / 365 days);
    }
}
