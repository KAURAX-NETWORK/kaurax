// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "../interfaces/IERC20.sol";

/// @title KauraxSwapPair
/// @notice A constant-product liquidity pool for two ERC-20 tokens on KAURAX.
///
/// @dev This is the well-understood `x * y >= k` design. The properties that make it safe
///      are all enforced here rather than in the router, because the router is only a
///      convenience and anyone may call this contract directly:
///
///        * **The k invariant is checked on every swap**, against balances read after the
///          transfer, with fees included. A swap that would reduce k reverts.
///        * **Amounts are derived from balance deltas**, never from caller-supplied
///          numbers. A caller cannot claim to have sent tokens it did not send.
///        * **A minimum liquidity is burned on the first mint**, so the pool can never be
///          drained to zero total supply and have its share price manipulated.
///        * **Reentrancy is locked** across every state-changing entry point.
///
///      Fee: 0.3% of the input, retained in the reserves for liquidity providers.
contract KauraxSwapPair is IERC20 {
    string public constant name = "KAURAX Swap LP";
    string public constant symbol = "KAX-LP";
    uint8 public constant decimals = 18;

    /// @notice Permanently burned on the first mint so totalSupply can never return to 0.
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    address public immutable FACTORY;
    address public token0;
    address public token1;

    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    uint256 private unlocked = 1;

    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    error Locked();
    error Forbidden();
    error AlreadyInitialised();
    error InsufficientLiquidityMinted();
    error InsufficientLiquidityBurned();
    error InsufficientOutputAmount();
    error InsufficientInputAmount();
    error InsufficientLiquidity();
    error InvalidRecipient();
    error KInvariantViolated();
    error Overflow();
    error TransferFailed();
    error InsufficientBalance();
    error InsufficientAllowance();

    modifier lock() {
        if (unlocked != 1) revert Locked();
        unlocked = 0;
        _;
        unlocked = 1;
    }

    constructor() {
        FACTORY = msg.sender;
    }

    /// @dev Called once by the factory immediately after deployment.
    function initialize(address _token0, address _token1) external {
        if (msg.sender != FACTORY) revert Forbidden();
        if (token0 != address(0)) revert AlreadyInitialised();
        token0 = _token0;
        token1 = _token1;
    }

    function getReserves()
        public
        view
        returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)
    {
        return (reserve0, reserve1, blockTimestampLast);
    }

    // ------------------------------------------------------------------ //
    //                             Liquidity                              //
    // ------------------------------------------------------------------ //

    /// @notice Mint LP tokens for whatever was transferred in since the last sync.
    /// @dev Call this only via the router, or after transferring both tokens yourself in
    ///      the same transaction — the amounts are read from balances, not from arguments.
    function mint(address to) external lock returns (uint256 liquidity) {
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0 = balance0 - _reserve0;
        uint256 amount1 = balance1 - _reserve1;

        uint256 _totalSupply = totalSupply;
        if (_totalSupply == 0) {
            liquidity = _sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            // Burned to address(1): address(0) would be indistinguishable from an
            // uninitialised balance in some tooling, and this must be provably unspendable.
            _mint(address(1), MINIMUM_LIQUIDITY);
        } else {
            // The smaller ratio, so a lopsided deposit does not dilute existing providers.
            uint256 byToken0 = (amount0 * _totalSupply) / _reserve0;
            uint256 byToken1 = (amount1 * _totalSupply) / _reserve1;
            liquidity = byToken0 < byToken1 ? byToken0 : byToken1;
        }

        if (liquidity == 0) revert InsufficientLiquidityMinted();
        _mint(to, liquidity);
        _update(balance0, balance1);

        emit Mint(msg.sender, amount0, amount1);
    }

    /// @notice Burn LP tokens held by this contract and return the underlying.
    function burn(address to) external lock returns (uint256 amount0, uint256 amount1) {
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 liquidity = balanceOf[address(this)];

        uint256 _totalSupply = totalSupply;
        amount0 = (liquidity * balance0) / _totalSupply;
        amount1 = (liquidity * balance1) / _totalSupply;
        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidityBurned();

        _burn(address(this), liquidity);
        _safeTransfer(token0, to, amount0);
        _safeTransfer(token1, to, amount1);

        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
        emit Burn(msg.sender, amount0, amount1, to);
    }

    // ------------------------------------------------------------------ //
    //                                Swap                                //
    // ------------------------------------------------------------------ //

    /// @notice Swap, having already transferred the input token in.
    /// @dev The k check below is the whole safety argument. Balances are read *after* the
    ///      optimistic transfer out, and the adjusted balances subtract a 0.3% fee from
    ///      whatever came in. If the product of the adjusted balances is less than the
    ///      product of the old reserves, value is leaving the pool and the call reverts.
    function swap(uint256 amount0Out, uint256 amount1Out, address to) external lock {
        if (amount0Out == 0 && amount1Out == 0) revert InsufficientOutputAmount();

        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
        if (amount0Out >= _reserve0 || amount1Out >= _reserve1) revert InsufficientLiquidity();

        uint256 balance0;
        uint256 balance1;

        // Scoped so `_token0`/`_token1` leave the stack before the invariant check below,
        // which otherwise exceeds the EVM's 16-slot reachable depth.
        {
            address _token0 = token0;
            address _token1 = token1;
            // Sending to a pool token would corrupt the balance accounting this relies on.
            if (to == _token0 || to == _token1) revert InvalidRecipient();

            if (amount0Out > 0) _safeTransfer(_token0, to, amount0Out);
            if (amount1Out > 0) _safeTransfer(_token1, to, amount1Out);

            balance0 = IERC20(_token0).balanceOf(address(this));
            balance1 = IERC20(_token1).balanceOf(address(this));
        }

        uint256 amount0In = balance0 > _reserve0 - amount0Out ? balance0 - (_reserve0 - amount0Out) : 0;
        uint256 amount1In = balance1 > _reserve1 - amount1Out ? balance1 - (_reserve1 - amount1Out) : 0;
        if (amount0In == 0 && amount1In == 0) revert InsufficientInputAmount();

        {
            // 0.3% fee: scale balances by 1000 and deduct 3x the input before comparing.
            // If the scaled product falls below the old product, value is leaving the pool.
            uint256 adjusted0 = balance0 * 1000 - amount0In * 3;
            uint256 adjusted1 = balance1 * 1000 - amount1In * 3;
            if (adjusted0 * adjusted1 < uint256(_reserve0) * uint256(_reserve1) * 1_000_000) {
                revert KInvariantViolated();
            }
        }

        _update(balance0, balance1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    /// @notice Force the reserves to match actual balances. Recovers from a donated token.
    function sync() external lock {
        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
    }

    /// @notice Send any excess above the reserves to `to`.
    function skim(address to) external lock {
        address _token0 = token0;
        address _token1 = token1;
        _safeTransfer(_token0, to, IERC20(_token0).balanceOf(address(this)) - reserve0);
        _safeTransfer(_token1, to, IERC20(_token1).balanceOf(address(this)) - reserve1);
    }

    // ------------------------------------------------------------------ //
    //                              ERC-20                                //
    // ------------------------------------------------------------------ //

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            unchecked {
                allowance[from][msg.sender] = allowed - amount;
            }
        }
        _transfer(from, to, amount);
        return true;
    }

    // ------------------------------------------------------------------ //
    //                             Internals                              //
    // ------------------------------------------------------------------ //

    function _update(uint256 balance0, uint256 balance1) private {
        if (balance0 > type(uint112).max || balance1 > type(uint112).max) revert Overflow();
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        blockTimestampLast = uint32(block.timestamp);
        emit Sync(reserve0, reserve1);
    }

    function _mint(address to, uint256 amount) private {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) private {
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }

    function _transfer(address from, address to, uint256 amount) private {
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = bal - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    /// @dev Accepts both the bool-returning and the void-returning ERC-20 conventions.
    function _safeTransfer(address token, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(abi.encodeCall(IERC20.transfer, (to, value)));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
