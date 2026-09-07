// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {KauraxBridgedERC20} from "./KauraxBridgedERC20.sol";
import {AddressAliasHelper} from "../libraries/AddressAliasHelper.sol";

interface IL3ToL2MessagePasser {
    function initiateWithdrawal(address _target, uint256 _gasLimit, bytes memory _data) external payable;
}

interface IKauraxL2ERC20Bridge {
    function finalizeWithdrawal(
        address _l2Token,
        address _l3Token,
        address _from,
        address _to,
        uint256 _amount
    ) external;
}

/// @title KauraxL3ERC20Bridge
/// @notice KAURAX-side counterpart of `KauraxL2ERC20Bridge`. Mints on deposit, burns on
///         withdrawal, and routes the withdrawal message through the message passer.
contract KauraxL3ERC20Bridge {
    IL3ToL2MessagePasser public immutable MESSAGE_PASSER;

    /// @notice The escrow bridge on the underlying L2.
    address public immutable OTHER_BRIDGE;

    /// @notice The aliased form of OTHER_BRIDGE, which is what a derived deposit arrives as.
    address public immutable OTHER_BRIDGE_ALIASED;

    event DepositFinalized(
        address indexed l2Token, address indexed l3Token, address indexed from, address to, uint256 amount
    );
    event WithdrawalInitiated(
        address indexed l2Token, address indexed l3Token, address indexed from, address to, uint256 amount
    );

    error NotCounterpartBridge();
    error TokenMismatch();
    error ZeroAddress();
    error ZeroAmount();

    constructor(address _messagePasser, address _otherBridge) {
        if (_messagePasser == address(0) || _otherBridge == address(0)) revert ZeroAddress();
        MESSAGE_PASSER = IL3ToL2MessagePasser(_messagePasser);
        OTHER_BRIDGE = _otherBridge;
        OTHER_BRIDGE_ALIASED = AddressAliasHelper.applyAlias(_otherBridge);
    }

    /// @notice Called by a derived deposit transaction. `msg.sender` is the aliased L2
    ///         bridge, which no key holder can produce.
    function finalizeDeposit(address _l2Token, address _l3Token, address _from, address _to, uint256 _amount)
        external
    {
        if (msg.sender != OTHER_BRIDGE_ALIASED) revert NotCounterpartBridge();
        if (KauraxBridgedERC20(_l3Token).REMOTE_TOKEN() != _l2Token) revert TokenMismatch();

        KauraxBridgedERC20(_l3Token).mint(_to, _amount);
        emit DepositFinalized(_l2Token, _l3Token, _from, _to, _amount);
    }

    /// @notice Burn the KAURAX representation and start a withdrawal on the L2.
    function bridgeERC20To(address _l3Token, address _to, uint256 _amount, uint64 _minGasLimit) external {
        if (_to == address(0)) revert ZeroAddress();
        if (_amount == 0) revert ZeroAmount();

        address l2Token = KauraxBridgedERC20(_l3Token).REMOTE_TOKEN();

        KauraxBridgedERC20(_l3Token).burn(msg.sender, _amount);

        bytes memory message = abi.encodeCall(
            IKauraxL2ERC20Bridge.finalizeWithdrawal, (l2Token, _l3Token, msg.sender, _to, _amount)
        );

        MESSAGE_PASSER.initiateWithdrawal(OTHER_BRIDGE, _minGasLimit, message);

        emit WithdrawalInitiated(l2Token, _l3Token, msg.sender, _to, _amount);
    }
}
