// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KauraxSwapFactory} from "../src/apps/KauraxSwapFactory.sol";
import {KauraxSwapPair} from "../src/apps/KauraxSwapPair.sol";
import {KauraxSwapRouter} from "../src/apps/KauraxSwapRouter.sol";
import {WKAX} from "../src/apps/WKAX.sol";
import {KauraxToken} from "../src/examples/KauraxToken.sol";

contract KauraxSwapTest is Test {
    KauraxSwapFactory internal factory;
    KauraxSwapRouter internal router;
    WKAX internal wkax;
    KauraxToken internal tokenA;
    KauraxToken internal tokenB;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant DEADLINE = type(uint256).max;

    function setUp() public {
        vm.warp(1_700_000_000);
        factory = new KauraxSwapFactory();
        wkax = new WKAX();
        router = new KauraxSwapRouter(address(factory), address(wkax));

        tokenA = new KauraxToken("Token A", "TKA", 18, 10_000_000e18);
        tokenB = new KauraxToken("Token B", "TKB", 18, 10_000_000e18);

        tokenA.transfer(alice, 1_000_000e18);
        tokenB.transfer(alice, 1_000_000e18);
        tokenA.transfer(bob, 1_000_000e18);
        tokenB.transfer(bob, 1_000_000e18);

        vm.deal(alice, 1000 ether);
        vm.deal(bob, 1000 ether);
    }

    function _seedPool(uint256 amountA, uint256 amountB) internal returns (address pair) {
        vm.startPrank(alice);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        router.addLiquidity(address(tokenA), address(tokenB), amountA, amountB, 0, 0, alice, DEADLINE);
        vm.stopPrank();
        return factory.getPair(address(tokenA), address(tokenB));
    }

    // ---------------------------------------------------------- factory --

    function test_createPairIsOrderIndependent() public {
        address pair = factory.createPair(address(tokenA), address(tokenB));
        assertEq(factory.getPair(address(tokenA), address(tokenB)), pair);
        assertEq(factory.getPair(address(tokenB), address(tokenA)), pair, "reverse lookup missing");
        assertEq(factory.allPairsLength(), 1);
    }

    function test_pairAddressIsPredictable() public {
        address predicted = factory.pairFor(address(tokenA), address(tokenB));
        address actual = factory.createPair(address(tokenA), address(tokenB));
        assertEq(actual, predicted, "CREATE2 address did not match the prediction");
    }

    function test_cannotCreateDuplicateOrIdenticalPair() public {
        factory.createPair(address(tokenA), address(tokenB));

        vm.expectRevert(KauraxSwapFactory.PairExists.selector);
        factory.createPair(address(tokenA), address(tokenB));

        vm.expectRevert(KauraxSwapFactory.PairExists.selector);
        factory.createPair(address(tokenB), address(tokenA));

        vm.expectRevert(KauraxSwapFactory.IdenticalAddresses.selector);
        factory.createPair(address(tokenA), address(tokenA));
    }

    function test_pairIsInitialisedWithSortedTokens() public {
        address pair = factory.createPair(address(tokenB), address(tokenA));
        (address t0, address t1) = address(tokenA) < address(tokenB)
            ? (address(tokenA), address(tokenB))
            : (address(tokenB), address(tokenA));
        assertEq(KauraxSwapPair(pair).token0(), t0);
        assertEq(KauraxSwapPair(pair).token1(), t1);
    }

    function test_onlyFactoryMayInitialise() public {
        address pair = factory.createPair(address(tokenA), address(tokenB));
        vm.expectRevert(KauraxSwapPair.AlreadyInitialised.selector);
        vm.prank(address(factory));
        KauraxSwapPair(pair).initialize(address(tokenA), address(tokenB));

        vm.expectRevert(KauraxSwapPair.Forbidden.selector);
        KauraxSwapPair(pair).initialize(address(tokenA), address(tokenB));
    }

    // -------------------------------------------------------- liquidity --

    function test_firstDepositSetsThePriceAndBurnsMinimumLiquidity() public {
        address pair = _seedPool(1000e18, 4000e18);
        KauraxSwapPair p = KauraxSwapPair(pair);

        (uint112 r0, uint112 r1,) = p.getReserves();
        assertGt(uint256(r0), 0);
        assertGt(uint256(r1), 0);

        // MINIMUM_LIQUIDITY is locked at address(1) forever, so supply can never reach 0.
        assertEq(p.balanceOf(address(1)), p.MINIMUM_LIQUIDITY());
        assertGt(p.balanceOf(alice), 0);
        assertEq(p.totalSupply(), p.balanceOf(alice) + p.MINIMUM_LIQUIDITY());
    }

    function test_secondDepositUsesTheSmallerRatio() public {
        _seedPool(1000e18, 4000e18);
        address pair = factory.getPair(address(tokenA), address(tokenB));

        // Offer a lopsided deposit: only the matching portion should be taken.
        vm.startPrank(bob);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        (uint256 usedA, uint256 usedB,) =
            router.addLiquidity(address(tokenA), address(tokenB), 100e18, 10_000e18, 0, 0, bob, DEADLINE);
        vm.stopPrank();

        assertEq(usedA, 100e18, "token A should be fully used");
        assertEq(usedB, 400e18, "token B should be capped at the pool ratio");
        assertGt(KauraxSwapPair(pair).balanceOf(bob), 0);
    }

    function test_removeLiquidityReturnsUnderlying() public {
        address pair = _seedPool(1000e18, 4000e18);
        KauraxSwapPair p = KauraxSwapPair(pair);
        uint256 lp = p.balanceOf(alice);

        uint256 beforeA = tokenA.balanceOf(alice);
        uint256 beforeB = tokenB.balanceOf(alice);

        vm.startPrank(alice);
        p.approve(address(router), lp);
        (uint256 outA, uint256 outB) =
            router.removeLiquidity(address(tokenA), address(tokenB), lp, 0, 0, alice, DEADLINE);
        vm.stopPrank();

        assertEq(tokenA.balanceOf(alice) - beforeA, outA);
        assertEq(tokenB.balanceOf(alice) - beforeB, outB);
        // A dust amount stays behind, backing the burned MINIMUM_LIQUIDITY.
        assertApproxEqRel(outA, 1000e18, 0.001e18);
        assertApproxEqRel(outB, 4000e18, 0.001e18);
    }

    function test_liquidityProviderEarnsFees() public {
        address pair = _seedPool(10_000e18, 10_000e18);
        KauraxSwapPair p = KauraxSwapPair(pair);
        uint256 lp = p.balanceOf(alice);

        // Trade back and forth so the pool accrues fees without moving the price much.
        address[] memory ab = new address[](2);
        ab[0] = address(tokenA);
        ab[1] = address(tokenB);
        address[] memory ba = new address[](2);
        ba[0] = address(tokenB);
        ba[1] = address(tokenA);

        vm.startPrank(bob);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        for (uint256 i; i < 6; i++) {
            router.swapExactTokensForTokens(500e18, 0, ab, bob, DEADLINE);
            router.swapExactTokensForTokens(500e18, 0, ba, bob, DEADLINE);
        }
        vm.stopPrank();

        vm.startPrank(alice);
        p.approve(address(router), lp);
        (uint256 outA, uint256 outB) =
            router.removeLiquidity(address(tokenA), address(tokenB), lp, 0, 0, alice, DEADLINE);
        vm.stopPrank();

        assertGt(outA + outB, 20_000e18, "provider did not earn trading fees");
    }

    // ------------------------------------------------------------ swaps --

    function test_swapMovesThePriceInTheRightDirection() public {
        _seedPool(10_000e18, 10_000e18);

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        uint256 before = tokenB.balanceOf(bob);
        vm.startPrank(bob);
        tokenA.approve(address(router), type(uint256).max);
        uint256[] memory amounts = router.swapExactTokensForTokens(1000e18, 0, path, bob, DEADLINE);
        vm.stopPrank();

        uint256 received = tokenB.balanceOf(bob) - before;
        assertEq(received, amounts[1]);
        // Fee plus slippage means strictly less than 1:1 out of a balanced pool.
        assertLt(received, 1000e18, "received more than the input from a balanced pool");
        assertGt(received, 900e18, "slippage is implausibly large");
    }

    function test_quotedOutputMatchesRealisedOutput() public {
        _seedPool(50_000e18, 50_000e18);

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        uint256[] memory quoted = router.getAmountsOut(777e18, path);

        uint256 before = tokenB.balanceOf(bob);
        vm.startPrank(bob);
        tokenA.approve(address(router), type(uint256).max);
        router.swapExactTokensForTokens(777e18, 0, path, bob, DEADLINE);
        vm.stopPrank();

        assertEq(tokenB.balanceOf(bob) - before, quoted[1], "quote did not match execution");
    }

    /// The slippage bound is the router's whole reason to exist.
    function test_slippageBoundIsEnforced() public {
        _seedPool(10_000e18, 10_000e18);

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        vm.startPrank(bob);
        tokenA.approve(address(router), type(uint256).max);
        vm.expectRevert();
        router.swapExactTokensForTokens(1000e18, 999e18, path, bob, DEADLINE);
        vm.stopPrank();
    }

    function test_deadlineIsEnforced() public {
        _seedPool(10_000e18, 10_000e18);

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        vm.startPrank(bob);
        tokenA.approve(address(router), type(uint256).max);
        vm.expectRevert(KauraxSwapRouter.Expired.selector);
        router.swapExactTokensForTokens(100e18, 0, path, bob, block.timestamp - 1);
        vm.stopPrank();
    }

    function test_swapTokensForExactTokens() public {
        _seedPool(10_000e18, 10_000e18);

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        uint256 want = 500e18;
        uint256 beforeB = tokenB.balanceOf(bob);
        uint256 beforeA = tokenA.balanceOf(bob);

        vm.startPrank(bob);
        tokenA.approve(address(router), type(uint256).max);
        uint256[] memory amounts =
            router.swapTokensForExactTokens(want, type(uint256).max, path, bob, DEADLINE);
        vm.stopPrank();

        assertEq(tokenB.balanceOf(bob) - beforeB, want, "did not receive the exact output");
        assertEq(beforeA - tokenA.balanceOf(bob), amounts[0]);
    }

    function test_maxInputBoundIsEnforced() public {
        _seedPool(10_000e18, 10_000e18);
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        vm.startPrank(bob);
        tokenA.approve(address(router), type(uint256).max);
        vm.expectRevert();
        router.swapTokensForExactTokens(500e18, 1e18, path, bob, DEADLINE);
        vm.stopPrank();
    }

    function test_multiHopSwap() public {
        // A/B and B/WKAX, then trade A -> B -> WKAX in one call.
        _seedPool(10_000e18, 10_000e18);

        vm.startPrank(alice);
        tokenB.approve(address(router), type(uint256).max);
        router.addLiquidityKAX{value: 100 ether}(address(tokenB), 10_000e18, 0, 0, alice, DEADLINE);
        vm.stopPrank();

        address[] memory path = new address[](3);
        path[0] = address(tokenA);
        path[1] = address(tokenB);
        path[2] = address(wkax);

        vm.startPrank(bob);
        tokenA.approve(address(router), type(uint256).max);
        uint256 before = bob.balance;
        uint256[] memory amounts = router.swapExactTokensForKAX(100e18, 0, path, bob, DEADLINE);
        vm.stopPrank();

        assertEq(amounts.length, 3);
        assertEq(bob.balance - before, amounts[2], "native KAX not delivered");
        assertGt(amounts[2], 0);
    }

    // ------------------------------------------------------- native KAX --

    function test_addAndRemoveLiquidityWithNativeKAX() public {
        vm.startPrank(alice);
        tokenA.approve(address(router), type(uint256).max);
        (,, uint256 liquidity) =
            router.addLiquidityKAX{value: 100 ether}(address(tokenA), 10_000e18, 0, 0, alice, DEADLINE);
        vm.stopPrank();

        address pair = factory.getPair(address(tokenA), address(wkax));
        assertEq(KauraxSwapPair(pair).balanceOf(alice), liquidity);
        assertEq(wkax.balanceOf(pair), 100 ether, "WKAX not deposited into the pair");

        uint256 beforeKax = alice.balance;
        vm.startPrank(alice);
        KauraxSwapPair(pair).approve(address(router), liquidity);
        (, uint256 outKAX) = router.removeLiquidityKAX(address(tokenA), liquidity, 0, 0, alice, DEADLINE);
        vm.stopPrank();

        assertEq(alice.balance - beforeKax, outKAX, "native KAX not returned");
        assertApproxEqRel(outKAX, 100 ether, 0.001e18);
    }

    function test_excessKAXIsRefundedOnAddLiquidity() public {
        // Seed at a fixed ratio, then over-send KAX and expect the excess back.
        vm.startPrank(alice);
        tokenA.approve(address(router), type(uint256).max);
        router.addLiquidityKAX{value: 100 ether}(address(tokenA), 10_000e18, 0, 0, alice, DEADLINE);
        vm.stopPrank();

        vm.startPrank(bob);
        tokenA.approve(address(router), type(uint256).max);
        uint256 before = bob.balance;
        router.addLiquidityKAX{value: 50 ether}(address(tokenA), 1_000e18, 0, 0, bob, DEADLINE);
        vm.stopPrank();

        // 1000 token A at the pool ratio needs 10 KAX; the other 40 must come back.
        assertApproxEqRel(before - bob.balance, 10 ether, 0.01e18, "excess KAX was not refunded");
    }

    function test_swapExactKAXForTokens() public {
        vm.startPrank(alice);
        tokenA.approve(address(router), type(uint256).max);
        router.addLiquidityKAX{value: 100 ether}(address(tokenA), 10_000e18, 0, 0, alice, DEADLINE);
        vm.stopPrank();

        address[] memory path = new address[](2);
        path[0] = address(wkax);
        path[1] = address(tokenA);

        uint256 before = tokenA.balanceOf(bob);
        vm.prank(bob);
        uint256[] memory amounts = router.swapExactKAXForTokens{value: 1 ether}(0, path, bob, DEADLINE);

        assertEq(tokenA.balanceOf(bob) - before, amounts[1]);
        assertGt(amounts[1], 0);
    }

    function test_nativePathMustStartOrEndWithWkax() public {
        _seedPool(10_000e18, 10_000e18);
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        vm.prank(bob);
        vm.expectRevert(KauraxSwapRouter.InvalidPath.selector);
        router.swapExactKAXForTokens{value: 1 ether}(0, path, bob, DEADLINE);
    }

    // ------------------------------------------------------- invariants --

    /// The core safety property: a direct pair call that would remove value must revert.
    function test_directSwapWithoutPayingReverts() public {
        address pair = _seedPool(10_000e18, 10_000e18);

        vm.prank(bob);
        vm.expectRevert(KauraxSwapPair.InsufficientInputAmount.selector);
        KauraxSwapPair(pair).swap(100e18, 0, bob);
    }

    /// Underpaying is caught by the k check, not by trusting the caller's numbers.
    function test_underpayingSwapViolatesK() public {
        address pair = _seedPool(10_000e18, 10_000e18);
        (address token0,) = address(tokenA) < address(tokenB)
            ? (address(tokenA), address(tokenB))
            : (address(tokenB), address(tokenA));

        // Send a token in, then ask for far more than it is worth.
        vm.startPrank(bob);
        KauraxToken(token0).transfer(pair, 1e18);
        vm.expectRevert(KauraxSwapPair.KInvariantViolated.selector);
        KauraxSwapPair(pair).swap(0, 1000e18, bob);
        vm.stopPrank();
    }

    function test_cannotSwapMoreThanReserves() public {
        address pair = _seedPool(1000e18, 1000e18);
        vm.prank(bob);
        vm.expectRevert(KauraxSwapPair.InsufficientLiquidity.selector);
        KauraxSwapPair(pair).swap(2000e18, 0, bob);
    }

    function test_cannotSendOutputToAPoolToken() public {
        address pair = _seedPool(10_000e18, 10_000e18);
        vm.prank(bob);
        vm.expectRevert(KauraxSwapPair.InvalidRecipient.selector);
        KauraxSwapPair(pair).swap(1e18, 0, address(tokenA));
    }

    /// k must never decrease across a swap. This is what stops value leaking out.
    function testFuzz_kNeverDecreases(uint96 rawAmountIn) public {
        uint256 amountIn = bound(uint256(rawAmountIn), 1e15, 5_000e18);
        address pair = _seedPool(50_000e18, 50_000e18);
        KauraxSwapPair p = KauraxSwapPair(pair);

        (uint112 r0Before, uint112 r1Before,) = p.getReserves();
        uint256 kBefore = uint256(r0Before) * uint256(r1Before);

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        vm.startPrank(bob);
        tokenA.approve(address(router), type(uint256).max);
        router.swapExactTokensForTokens(amountIn, 0, path, bob, DEADLINE);
        vm.stopPrank();

        (uint112 r0After, uint112 r1After,) = p.getReserves();
        assertGe(uint256(r0After) * uint256(r1After), kBefore, "k decreased across a swap");
    }

    function testFuzz_getAmountOutIsMonotonic(uint96 a, uint96 b) public view {
        uint256 x = bound(uint256(a), 1e15, 1_000e18);
        uint256 y = bound(uint256(b), 1e15, 1_000e18);
        if (x > y) (x, y) = (y, x);
        uint256 outX = router.getAmountOut(x, 100_000e18, 100_000e18);
        uint256 outY = router.getAmountOut(y, 100_000e18, 100_000e18);
        assertLe(outX, outY, "more input produced less output");
    }

    /// getAmountIn must round in the pool's favour, or quotes revert on execution.
    function testFuzz_getAmountInRoundsUp(uint96 rawOut) public view {
        uint256 amountOut = bound(uint256(rawOut), 1e15, 10_000e18);
        uint256 amountIn = router.getAmountIn(amountOut, 100_000e18, 100_000e18);
        assertGe(
            router.getAmountOut(amountIn, 100_000e18, 100_000e18), amountOut, "quoted input was too small"
        );
    }

    // ------------------------------------------------------------- WKAX --

    function test_wkaxIsFullyBacked() public {
        vm.prank(alice);
        wkax.deposit{value: 10 ether}();
        assertEq(wkax.balanceOf(alice), 10 ether);
        assertEq(wkax.totalSupply(), address(wkax).balance, "WKAX supply is not fully backed");

        vm.prank(alice);
        wkax.withdraw(4 ether);
        assertEq(wkax.balanceOf(alice), 6 ether);
        assertEq(wkax.totalSupply(), address(wkax).balance, "backing broke on withdrawal");
    }

    function test_wkaxReceiveWraps() public {
        vm.prank(alice);
        (bool ok,) = address(wkax).call{value: 3 ether}("");
        assertTrue(ok);
        assertEq(wkax.balanceOf(alice), 3 ether);
    }

    function test_cannotWithdrawMoreWkaxThanHeld() public {
        vm.prank(alice);
        wkax.deposit{value: 1 ether}();
        vm.prank(alice);
        vm.expectRevert(WKAX.InsufficientBalance.selector);
        wkax.withdraw(2 ether);
    }
}
