// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KauraxPortal} from "../src/L2/KauraxPortal.sol";
import {KauraxL2OutputOracle} from "../src/L2/KauraxL2OutputOracle.sol";
import {KauraxL2ERC20Bridge} from "../src/L2/KauraxL2ERC20Bridge.sol";
import {KauraxL3ERC20Bridge} from "../src/L3/KauraxL3ERC20Bridge.sol";
import {KauraxBridgedERC20} from "../src/L3/KauraxBridgedERC20.sol";
import {L3ToL2MessagePasser} from "../src/L3/L3ToL2MessagePasser.sol";
import {ReentrancyGuard} from "../src/libraries/ReentrancyGuard.sol";

interface ITokensToSend {
    function tokensToSend(address to, uint256 amount) external;
}

/// @notice An ERC-20 that notifies the sender before moving balances.
///
/// @dev This is ERC-777's `tokensToSend` hook, reduced to the one behaviour that matters
///      here. It is not a contrived construction: ERC-777 is a finalised standard with
///      deployed tokens, and `KauraxL2ERC20Bridge.bridgeERC20To` accepts an arbitrary token
///      address with no allow-list, so nothing stops one being bridged.
contract HookToken {
    string public name = "Hook Token";
    string public symbol = "HOOK";
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public hookHolder;

    function setHookHolder(address _h) external {
        hookHolder = _h;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        // The hook fires before any balance moves, exactly as ERC-777 specifies.
        if (from == hookHolder && from.code.length > 0) {
            ITokensToSend(from).tokensToSend(to, amount);
        }
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @notice Deposits twice, the second time from inside the first deposit's transfer hook.
contract ReenteringDepositor is ITokensToSend {
    KauraxL2ERC20Bridge internal immutable BRIDGE;
    HookToken internal immutable TOKEN;
    address internal immutable L3_TOKEN;
    uint256 internal immutable AMOUNT;

    bool internal entered;

    constructor(KauraxL2ERC20Bridge _bridge, HookToken _token, address _l3Token, uint256 _amount) {
        BRIDGE = _bridge;
        TOKEN = _token;
        L3_TOKEN = _l3Token;
        AMOUNT = _amount;
    }

    /// @dev When true the inner deposit's revert is swallowed, so the outer deposit runs to
    ///      completion. That is the harder case for the bridge: the attack does not abort the
    ///      transaction, so nothing but correct accounting prevents the over-credit.
    bool public swallowRevert;

    function setSwallowRevert(bool _v) external {
        swallowRevert = _v;
    }

    function tokensToSend(address, uint256) external override {
        if (entered) return;
        entered = true;
        if (swallowRevert) {
            try BRIDGE.bridgeERC20To(address(TOKEN), L3_TOKEN, address(this), AMOUNT, 200_000) {} catch {}
        } else {
            BRIDGE.bridgeERC20To(address(TOKEN), L3_TOKEN, address(this), AMOUNT, 200_000);
        }
    }

    function attack() external {
        TOKEN.approve(address(BRIDGE), type(uint256).max);
        BRIDGE.bridgeERC20To(address(TOKEN), L3_TOKEN, address(this), AMOUNT, 200_000);
    }
}

/// @notice Escrow accounting must survive a token that calls back during `transferFrom`.
///
/// @dev `bridgeERC20To` measures `balanceOf` before and after the pull so that a
///      fee-on-transfer token cannot mint more on L3 than was escrowed. That measurement
///      spans an external call into an attacker-chosen contract. If that call re-enters,
///      the inner deposit's tokens land before the outer deposit reads its "after" balance,
///      so the outer deposit counts the inner deposit's tokens as its own and credits them
///      twice.
contract BridgeReentrancyTest is Test {
    KauraxL2OutputOracle internal oracle;
    KauraxPortal internal portal;
    KauraxL2ERC20Bridge internal l2Bridge;
    KauraxL3ERC20Bridge internal l3Bridge;
    L3ToL2MessagePasser internal passer;
    HookToken internal token;
    KauraxBridgedERC20 internal l3Token;

    uint256 internal constant AMOUNT = 100e18;

    address internal proposer = makeAddr("proposer");
    address internal challenger = makeAddr("challenger");
    address internal guardian = makeAddr("guardian");
    address internal sequencerAddress = makeAddr("sequencer");

    function setUp() public {
        vm.warp(10_000);
        oracle = new KauraxL2OutputOracle(10, 2, 1, block.timestamp - 1000, 120, proposer, challenger, 0);
        portal = new KauraxPortal(address(oracle), guardian, sequencerAddress, 100);
        passer = new L3ToL2MessagePasser();

        address predictedL3Bridge = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        l2Bridge = new KauraxL2ERC20Bridge(address(portal), predictedL3Bridge);
        l3Bridge = new KauraxL3ERC20Bridge(address(passer), address(l2Bridge));

        token = new HookToken();
        l3Token = new KauraxBridgedERC20(address(l3Bridge), address(token), "Hook (KAURAX)", "HOOK", 18);
    }

    /// The invariant the bridge exists to hold: KAURAX may never be told to mint more than
    /// the L2 escrow actually received.
    ///
    /// Before the guard this failed with 300e18 credited against 200e18 escrowed.
    function test_creditNeverExceedsEscrowUnderAReentrantToken() public {
        ReenteringDepositor attacker = new ReenteringDepositor(l2Bridge, token, address(l3Token), AMOUNT);
        token.mint(address(attacker), 2 * AMOUNT);
        token.setHookHolder(address(attacker));
        attacker.setSwallowRevert(true);

        attacker.attack();

        uint256 escrowed = token.balanceOf(address(l2Bridge));
        uint256 credited = l2Bridge.deposits(address(token), address(l3Token));

        assertEq(
            credited,
            escrowed,
            "the bridge credited KAURAX with more than it escrowed; the surplus is unbacked supply"
        );
        assertEq(credited, AMOUNT, "exactly one deposit should have been credited");
    }

    /// The re-entrant call itself must be refused, not merely accounted around.
    function test_reentrantDepositIsRefused() public {
        ReenteringDepositor attacker = new ReenteringDepositor(l2Bridge, token, address(l3Token), AMOUNT);
        token.mint(address(attacker), 2 * AMOUNT);
        token.setHookHolder(address(attacker));

        vm.expectRevert(ReentrancyGuard.Reentrancy.selector);
        attacker.attack();
    }

    /// The balance-delta measurement exists for fee-on-transfer tokens and must keep working:
    /// the guard fixes the reentrancy, it must not regress the thing the delta was for.
    function test_feeOnTransferTokenCreditsOnlyWhatArrived() public {
        FeeToken fee = new FeeToken(1000); // 10% withheld
        KauraxBridgedERC20 l3Fee =
            new KauraxBridgedERC20(address(l3Bridge), address(fee), "Fee (KAURAX)", "FEE", 18);

        address alice = makeAddr("alice");
        fee.mint(alice, AMOUNT);

        vm.startPrank(alice);
        fee.approve(address(l2Bridge), AMOUNT);
        l2Bridge.bridgeERC20To(address(fee), address(l3Fee), alice, AMOUNT, 200_000);
        vm.stopPrank();

        uint256 arrived = fee.balanceOf(address(l2Bridge));
        assertEq(arrived, (AMOUNT * 9000) / 10_000, "fee token did not withhold as expected");
        assertEq(
            l2Bridge.deposits(address(fee), address(l3Fee)),
            arrived,
            "credit must equal what arrived, not what was requested"
        );
    }

    /// An ordinary deposit through a token with no hook is unchanged by the guard.
    function test_ordinaryDepositIsUnaffected() public {
        address alice = makeAddr("alice");
        token.mint(alice, AMOUNT);

        vm.startPrank(alice);
        token.approve(address(l2Bridge), AMOUNT);
        l2Bridge.bridgeERC20To(address(token), address(l3Token), alice, AMOUNT, 200_000);
        vm.stopPrank();

        assertEq(token.balanceOf(address(l2Bridge)), AMOUNT);
        assertEq(l2Bridge.deposits(address(token), address(l3Token)), AMOUNT);
    }

    /// Two separate deposits in separate transactions must both go through — the guard is
    /// transient, so it cannot leak a lock from one transaction into the next.
    function test_guardDoesNotLeakBetweenTransactions() public {
        address alice = makeAddr("alice");
        token.mint(alice, 2 * AMOUNT);

        vm.startPrank(alice);
        token.approve(address(l2Bridge), 2 * AMOUNT);
        l2Bridge.bridgeERC20To(address(token), address(l3Token), alice, AMOUNT, 200_000);
        l2Bridge.bridgeERC20To(address(token), address(l3Token), alice, AMOUNT, 200_000);
        vm.stopPrank();

        assertEq(l2Bridge.deposits(address(token), address(l3Token)), 2 * AMOUNT);
    }
}

/// @notice Withholds a fixed proportion of every transfer.
contract FeeToken {
    uint256 public immutable FEE_BPS;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint256 _feeBps) {
        FEE_BPS = _feeBps;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        uint256 net = amount - (amount * FEE_BPS) / 10_000;
        balanceOf[to] += net;
        totalSupply -= amount - net;
        return true;
    }
}
