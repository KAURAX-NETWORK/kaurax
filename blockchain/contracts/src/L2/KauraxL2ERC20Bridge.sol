// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "../interfaces/IERC20.sol";
import {IKauraxPortal} from "../interfaces/IKauraxPortal.sol";
import {ReentrancyGuard} from "../libraries/ReentrancyGuard.sol";

interface IKauraxL3ERC20Bridge {
    function finalizeDeposit(address _l2Token, address _l3Token, address _from, address _to, uint256 _amount)
        external;
}

interface IPortalSender {
    function l3Sender() external view returns (address);
}

/// @title KauraxL2ERC20Bridge
/// @notice Escrows ERC-20s on the underlying L2 while a representation circulates on
///         KAURAX. Deposits travel over the portal's deposit path; withdrawals arrive as
///         finalized withdrawal calls from the portal.
contract KauraxL2ERC20Bridge is ReentrancyGuard {
    IKauraxPortal public immutable PORTAL;

    /// @notice The counterpart bridge on KAURAX.
    address public immutable OTHER_BRIDGE;

    /// @notice l2Token => l3Token => escrowed amount.
    mapping(address => mapping(address => uint256)) public deposits;

    event ERC20DepositInitiated(
        address indexed l2Token, address indexed l3Token, address indexed from, address to, uint256 amount
    );
    event ERC20WithdrawalFinalized(
        address indexed l2Token, address indexed l3Token, address indexed from, address to, uint256 amount
    );

    error ZeroAddress();
    error ZeroAmount();
    error TransferFailed();
    error NotPortal();
    error NotCounterpartBridge();
    error InsufficientEscrow();

    constructor(address _portal, address _otherBridge) {
        if (_portal == address(0) || _otherBridge == address(0)) revert ZeroAddress();
        PORTAL = IKauraxPortal(_portal);
        OTHER_BRIDGE = _otherBridge;
    }

    /// @notice Escrow `_amount` of `_l2Token` and instruct KAURAX to mint the counterpart.
    /// @param _minGasLimit Gas for the L3-side finalizeDeposit call.
    // The detector reports the balance-delta measurement spanning `transferFrom`. That was
    // a real finding — see test/BridgeReentrancy.t.sol — and it is closed by `nonReentrant`.
    // slither does not model reentrancy guards, so it still reports the shape. The directive
    // must be the last line before the declaration: it applies to the next line, literally.
    // slither-disable-next-line reentrancy-balance
    function bridgeERC20To(
        address _l2Token,
        address _l3Token,
        address _to,
        uint256 _amount,
        uint64 _minGasLimit
    ) external nonReentrant {
        if (_to == address(0)) revert ZeroAddress();
        if (_amount == 0) revert ZeroAmount();

        // Pull first, measure actual delta: fee-on-transfer tokens would otherwise let a
        // depositor mint more on L3 than was escrowed here.
        //
        // The measurement spans `transferFrom`, an external call into a token address the
        // caller chooses and which is not allow-listed. A token that calls back — ERC-777's
        // `tokensToSend` is the standard case — could re-enter, land its own tokens before
        // this frame read its `after` balance, and have them counted twice. `nonReentrant`
        // is what makes the delta trustworthy; the delta itself is correct and must stay.
        uint256 before = IERC20(_l2Token).balanceOf(address(this));
        bool ok = IERC20(_l2Token).transferFrom(msg.sender, address(this), _amount);
        if (!ok) revert TransferFailed();
        uint256 received = IERC20(_l2Token).balanceOf(address(this)) - before;
        if (received == 0) revert ZeroAmount();

        deposits[_l2Token][_l3Token] += received;

        bytes memory message = abi.encodeCall(
            IKauraxL3ERC20Bridge.finalizeDeposit, (_l2Token, _l3Token, msg.sender, _to, received)
        );

        PORTAL.depositTransaction(OTHER_BRIDGE, 0, _minGasLimit, false, message);

        emit ERC20DepositInitiated(_l2Token, _l3Token, msg.sender, _to, received);
    }

    /// @notice Release escrowed tokens. Callable only by the portal, and only while it is
    ///         finalizing a withdrawal that originated at the counterpart bridge.
    function finalizeWithdrawal(
        address _l2Token,
        address _l3Token,
        address _from,
        address _to,
        uint256 _amount
    ) external nonReentrant {
        if (msg.sender != address(PORTAL)) revert NotPortal();
        if (IPortalSender(address(PORTAL)).l3Sender() != OTHER_BRIDGE) revert NotCounterpartBridge();

        uint256 escrowed = deposits[_l2Token][_l3Token];
        if (escrowed < _amount) revert InsufficientEscrow();
        unchecked {
            deposits[_l2Token][_l3Token] = escrowed - _amount;
        }

        bool ok = IERC20(_l2Token).transfer(_to, _amount);
        if (!ok) revert TransferFailed();

        emit ERC20WithdrawalFinalized(_l2Token, _l3Token, _from, _to, _amount);
    }
}
