// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KauraxBridgedERC20} from "../src/L3/KauraxBridgedERC20.sol";

/// @notice The KAURAX-side representation of an escrowed L2 token. Its supply is the
///         claim on the L2 escrow, so anything that can mint without a deposit, or fail to
///         burn on withdrawal, is a solvency bug.
contract KauraxBridgedERC20Test is Test {
    KauraxBridgedERC20 internal token;

    address internal bridge = makeAddr("bridge");
    address internal remote = makeAddr("remoteToken");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        token = new KauraxBridgedERC20(bridge, remote, "Test (KAURAX)", "TEST", 18);
    }

    function test_metadataAndCounterpartAreFixedAtConstruction() public view {
        assertEq(token.name(), "Test (KAURAX)");
        assertEq(token.symbol(), "TEST");
        assertEq(token.decimals(), 18);
        assertEq(token.BRIDGE(), bridge);
        assertEq(token.REMOTE_TOKEN(), remote);
    }

    // ------------------------------------------------------------------- supply control --

    function test_onlyTheBridgeMayMint() public {
        vm.prank(alice);
        vm.expectRevert(KauraxBridgedERC20.NotBridge.selector);
        token.mint(alice, 1e18);
    }

    function test_onlyTheBridgeMayBurn() public {
        vm.prank(bridge);
        token.mint(alice, 1e18);

        vm.prank(alice);
        vm.expectRevert(KauraxBridgedERC20.NotBridge.selector);
        token.burn(alice, 1e18);
    }

    function test_mintAndBurnMoveTotalSupply() public {
        vm.startPrank(bridge);
        token.mint(alice, 5e18);
        assertEq(token.totalSupply(), 5e18);
        assertEq(token.balanceOf(alice), 5e18);

        token.burn(alice, 2e18);
        assertEq(token.totalSupply(), 3e18);
        assertEq(token.balanceOf(alice), 3e18);
        vm.stopPrank();
    }

    /// Burning more than the holder has would drive totalSupply below the escrow it
    /// represents; the unchecked block makes the guard the only thing preventing it.
    function test_burnRevertsRatherThanUnderflowing() public {
        vm.startPrank(bridge);
        token.mint(alice, 1e18);
        vm.expectRevert(KauraxBridgedERC20.InsufficientBalance.selector);
        token.burn(alice, 1e18 + 1);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------------- transfers --

    function test_transferMovesBalance() public {
        vm.prank(bridge);
        token.mint(alice, 10e18);

        vm.prank(alice);
        assertTrue(token.transfer(bob, 4e18));

        assertEq(token.balanceOf(alice), 6e18);
        assertEq(token.balanceOf(bob), 4e18);
        assertEq(token.totalSupply(), 10e18, "a transfer must not change supply");
    }

    function test_transferRevertsOnInsufficientBalance() public {
        vm.prank(alice);
        vm.expectRevert(KauraxBridgedERC20.InsufficientBalance.selector);
        token.transfer(bob, 1);
    }

    function test_approveAndTransferFromSpendsTheAllowance() public {
        vm.prank(bridge);
        token.mint(alice, 10e18);

        vm.prank(alice);
        token.approve(bob, 4e18);
        assertEq(token.allowance(alice, bob), 4e18);

        vm.prank(bob);
        assertTrue(token.transferFrom(alice, bob, 3e18));

        assertEq(token.allowance(alice, bob), 1e18, "allowance must decrease by the amount spent");
        assertEq(token.balanceOf(bob), 3e18);
    }

    function test_transferFromRevertsWhenAllowanceIsShort() public {
        vm.prank(bridge);
        token.mint(alice, 10e18);

        vm.prank(alice);
        token.approve(bob, 1e18);

        vm.prank(bob);
        vm.expectRevert(KauraxBridgedERC20.InsufficientAllowance.selector);
        token.transferFrom(alice, bob, 1e18 + 1);
    }

    /// The max-uint allowance is treated as infinite and must not be decremented, or a
    /// long-lived approval would silently erode.
    function test_infiniteAllowanceIsNotDecremented() public {
        vm.prank(bridge);
        token.mint(alice, 10e18);

        vm.prank(alice);
        token.approve(bob, type(uint256).max);

        vm.prank(bob);
        token.transferFrom(alice, bob, 7e18);

        assertEq(token.allowance(alice, bob), type(uint256).max);
    }

    /// An allowance is not a balance: spending must still be bounded by what the owner has.
    function test_transferFromRevertsWhenTheOwnerIsShortEvenWithAllowance() public {
        vm.prank(bridge);
        token.mint(alice, 1e18);

        vm.prank(alice);
        token.approve(bob, type(uint256).max);

        vm.prank(bob);
        vm.expectRevert(KauraxBridgedERC20.InsufficientBalance.selector);
        token.transferFrom(alice, bob, 2e18);
    }

    function testFuzz_supplyEqualsTheSumOfBalances(uint128 mintA, uint128 mintB, uint128 burnA) public {
        vm.assume(burnA <= mintA);

        vm.startPrank(bridge);
        token.mint(alice, mintA);
        token.mint(bob, mintB);
        token.burn(alice, burnA);
        vm.stopPrank();

        assertEq(token.totalSupply(), uint256(mintA) + uint256(mintB) - uint256(burnA));
        assertEq(token.balanceOf(alice) + token.balanceOf(bob), token.totalSupply());
    }
}
