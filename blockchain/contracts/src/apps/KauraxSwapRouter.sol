// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "../interfaces/IERC20.sol";
import {KauraxSwapFactory} from "./KauraxSwapFactory.sol";
import {KauraxSwapPair} from "./KauraxSwapPair.sol";

interface IWKAX is IERC20 {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @title KauraxSwapRouter
/// @notice User-facing entry point for KAURAX Swap: liquidity, swaps, and native KAX.
///
/// @dev The router holds no funds between transactions and grants itself no privileges —
///      the pairs enforce their own invariants, and anyone may bypass this contract
///      entirely. What it provides is the safety a raw pair call lacks:
///
///        * **Slippage bounds.** Every function takes a minimum output or maximum input
///          and reverts if the realised price is worse. Without this, a swap sent into a
///          moving pool executes at whatever price it lands on.
///        * **Deadlines.** A transaction stuck in the mempool cannot be executed later at a
///          price the sender never agreed to.
///        * **Native KAX wrapping**, so users trade KAX without holding WKAX themselves.
contract KauraxSwapRouter {
    KauraxSwapFactory public immutable FACTORY;
    IWKAX public immutable WKAX_TOKEN;

    error Expired();
    error IdenticalAddresses();
    error ZeroAddress();
    error InsufficientAmount();
    error InsufficientLiquidity();
    error InsufficientOutputAmount(uint256 got, uint256 minimum);
    error ExcessiveInputAmount(uint256 needed, uint256 maximum);
    error InvalidPath();
    error PairDoesNotExist();
    error TransferFailed();

    modifier ensure(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    constructor(address factory, address wkax) {
        if (factory == address(0) || wkax == address(0)) revert ZeroAddress();
        FACTORY = KauraxSwapFactory(factory);
        WKAX_TOKEN = IWKAX(wkax);
    }

    /// @dev Only WKAX may send KAX here — that is the unwrap path. Anything else is a
    ///      mistake and is rejected rather than silently absorbed.
    receive() external payable {
        if (msg.sender != address(WKAX_TOKEN)) revert TransferFailed();
    }

    // ------------------------------------------------------------------ //
    //                             Liquidity                              //
    // ------------------------------------------------------------------ //

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        (amountA, amountB) =
            _computeLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);

        address pair = _pairFor(tokenA, tokenB);
        _safeTransferFrom(tokenA, msg.sender, pair, amountA);
        _safeTransferFrom(tokenB, msg.sender, pair, amountB);
        liquidity = KauraxSwapPair(pair).mint(to);
    }

    /// @notice Add liquidity using native KAX on one side. Excess KAX is refunded.
    function addLiquidityKAX(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountKAXMin,
        address to,
        uint256 deadline
    ) external payable ensure(deadline) returns (uint256 amountToken, uint256 amountKAX, uint256 liquidity) {
        (amountToken, amountKAX) = _computeLiquidity(
            token, address(WKAX_TOKEN), amountTokenDesired, msg.value, amountTokenMin, amountKAXMin
        );

        address pair = _pairFor(token, address(WKAX_TOKEN));
        _safeTransferFrom(token, msg.sender, pair, amountToken);

        WKAX_TOKEN.deposit{value: amountKAX}();
        if (!WKAX_TOKEN.transfer(pair, amountKAX)) revert TransferFailed();

        liquidity = KauraxSwapPair(pair).mint(to);

        if (msg.value > amountKAX) _sendKAX(msg.sender, msg.value - amountKAX);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) public ensure(deadline) returns (uint256 amountA, uint256 amountB) {
        address pair = _pairFor(tokenA, tokenB);
        _safeTransferFrom(pair, msg.sender, pair, liquidity);

        (uint256 amount0, uint256 amount1) = KauraxSwapPair(pair).burn(to);
        (address token0,) = _sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);

        if (amountA < amountAMin) revert InsufficientOutputAmount(amountA, amountAMin);
        if (amountB < amountBMin) revert InsufficientOutputAmount(amountB, amountBMin);
    }

    function removeLiquidityKAX(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountKAXMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountToken, uint256 amountKAX) {
        // Withdraw to this contract first so the WKAX can be unwrapped before forwarding.
        (amountToken, amountKAX) = removeLiquidity(
            token, address(WKAX_TOKEN), liquidity, amountTokenMin, amountKAXMin, address(this), deadline
        );
        _safeTransfer(token, to, amountToken);
        WKAX_TOKEN.withdraw(amountKAX);
        _sendKAX(to, amountKAX);
    }

    // ------------------------------------------------------------------ //
    //                                Swaps                               //
    // ------------------------------------------------------------------ //

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        amounts = getAmountsOut(amountIn, path);
        uint256 out = amounts[amounts.length - 1];
        if (out < amountOutMin) revert InsufficientOutputAmount(out, amountOutMin);

        _safeTransferFrom(path[0], msg.sender, _pairFor(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }

    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        amounts = getAmountsIn(amountOut, path);
        if (amounts[0] > amountInMax) revert ExcessiveInputAmount(amounts[0], amountInMax);

        _safeTransferFrom(path[0], msg.sender, _pairFor(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }

    /// @notice Swap native KAX for tokens. `path[0]` must be WKAX.
    function swapExactKAXForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable ensure(deadline) returns (uint256[] memory amounts) {
        if (path[0] != address(WKAX_TOKEN)) revert InvalidPath();

        amounts = getAmountsOut(msg.value, path);
        uint256 out = amounts[amounts.length - 1];
        if (out < amountOutMin) revert InsufficientOutputAmount(out, amountOutMin);

        WKAX_TOKEN.deposit{value: amounts[0]}();
        if (!WKAX_TOKEN.transfer(_pairFor(path[0], path[1]), amounts[0])) revert TransferFailed();
        _swap(amounts, path, to);
    }

    /// @notice Swap tokens for native KAX. The last hop must be WKAX.
    function swapExactTokensForKAX(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        if (path[path.length - 1] != address(WKAX_TOKEN)) revert InvalidPath();

        amounts = getAmountsOut(amountIn, path);
        uint256 out = amounts[amounts.length - 1];
        if (out < amountOutMin) revert InsufficientOutputAmount(out, amountOutMin);

        _safeTransferFrom(path[0], msg.sender, _pairFor(path[0], path[1]), amounts[0]);
        // Receive WKAX here so it can be unwrapped before forwarding native KAX.
        _swap(amounts, path, address(this));
        WKAX_TOKEN.withdraw(out);
        _sendKAX(to, out);
    }

    // ------------------------------------------------------------------ //
    //                              Quoting                               //
    // ------------------------------------------------------------------ //

    /// @notice Equivalent amount of B for `amountA`, at the current reserve ratio.
    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) public pure returns (uint256) {
        if (amountA == 0) revert InsufficientAmount();
        if (reserveA == 0 || reserveB == 0) revert InsufficientLiquidity();
        return (amountA * reserveB) / reserveA;
    }

    /// @notice Output for a given input, after the 0.3% fee.
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        public
        pure
        returns (uint256)
    {
        if (amountIn == 0) revert InsufficientAmount();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();

        uint256 amountInWithFee = amountIn * 997;
        return (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

    /// @notice Input required for a given output, after the 0.3% fee.
    /// @dev Rounds up (+1), so the caller always sends enough to satisfy the pair's own
    ///      invariant check. Rounding down here would produce quotes that revert on chain.
    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        public
        pure
        returns (uint256)
    {
        if (amountOut == 0) revert InsufficientAmount();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        if (amountOut >= reserveOut) revert InsufficientLiquidity();

        return ((reserveIn * amountOut * 1000) / ((reserveOut - amountOut) * 997)) + 1;
    }

    function getAmountsOut(uint256 amountIn, address[] memory path)
        public
        view
        returns (uint256[] memory amounts)
    {
        if (path.length < 2) revert InvalidPath();
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i < path.length - 1; i++) {
            (uint256 reserveIn, uint256 reserveOut) = getReserves(path[i], path[i + 1]);
            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    function getAmountsIn(uint256 amountOut, address[] memory path)
        public
        view
        returns (uint256[] memory amounts)
    {
        if (path.length < 2) revert InvalidPath();
        amounts = new uint256[](path.length);
        amounts[amounts.length - 1] = amountOut;
        for (uint256 i = path.length - 1; i > 0; i--) {
            (uint256 reserveIn, uint256 reserveOut) = getReserves(path[i - 1], path[i]);
            amounts[i - 1] = getAmountIn(amounts[i], reserveIn, reserveOut);
        }
    }

    /// @notice Reserves of a pair, ordered to match (tokenA, tokenB).
    function getReserves(address tokenA, address tokenB)
        public
        view
        returns (uint256 reserveA, uint256 reserveB)
    {
        address pair = _pairFor(tokenA, tokenB);
        (uint112 reserve0, uint112 reserve1,) = KauraxSwapPair(pair).getReserves();
        (address token0,) = _sortTokens(tokenA, tokenB);
        return tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    // ------------------------------------------------------------------ //
    //                             Internals                              //
    // ------------------------------------------------------------------ //

    function _computeLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) internal returns (uint256 amountA, uint256 amountB) {
        if (FACTORY.getPair(tokenA, tokenB) == address(0)) {
            FACTORY.createPair(tokenA, tokenB);
        }

        (uint256 reserveA, uint256 reserveB) = getReserves(tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            // First deposit sets the price, so the depositor's ratio is taken as given.
            return (amountADesired, amountBDesired);
        }

        uint256 amountBOptimal = quote(amountADesired, reserveA, reserveB);
        if (amountBOptimal <= amountBDesired) {
            if (amountBOptimal < amountBMin) revert InsufficientOutputAmount(amountBOptimal, amountBMin);
            return (amountADesired, amountBOptimal);
        }

        uint256 amountAOptimal = quote(amountBDesired, reserveB, reserveA);
        if (amountAOptimal < amountAMin) revert InsufficientOutputAmount(amountAOptimal, amountAMin);
        return (amountAOptimal, amountBDesired);
    }

    function _swap(uint256[] memory amounts, address[] memory path, address to) internal {
        for (uint256 i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = _sortTokens(input, output);
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) =
                input == token0 ? (uint256(0), amountOut) : (amountOut, uint256(0));
            // Intermediate hops pay straight into the next pair, avoiding a round trip.
            address recipient = i < path.length - 2 ? _pairFor(output, path[i + 2]) : to;
            KauraxSwapPair(_pairFor(input, output)).swap(amount0Out, amount1Out, recipient);
        }
    }

    function _pairFor(address tokenA, address tokenB) internal view returns (address pair) {
        pair = FACTORY.getPair(tokenA, tokenB);
        if (pair == address(0)) revert PairDoesNotExist();
    }

    function _sortTokens(address tokenA, address tokenB)
        internal
        pure
        returns (address token0, address token1)
    {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
    }

    function _safeTransfer(address token, address to, uint256 value) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.transfer, (to, value)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.transferFrom, (from, to, value)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _sendKAX(address to, uint256 amount) internal {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
