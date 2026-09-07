// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "../interfaces/IERC20.sol";

/// @title WKAX — wrapped KAX
/// @notice An ERC-20 representation of the native KAURAX asset, backed 1:1.
///
/// @dev An AMM pair holds two ERC-20s. KAX is the native currency and is not one, so it is
///      wrapped here. The invariant is simple and total: `totalSupply == address(this).balance`,
///      because the only ways to change either are `deposit` and `withdraw`, which move both
///      together.
contract WKAX is IERC20 {
    string public constant name = "Wrapped KAX";
    string public constant symbol = "WKAX";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Deposit(address indexed account, uint256 amount);
    event Withdrawal(address indexed account, uint256 amount);

    error InsufficientBalance();
    error InsufficientAllowance();
    error TransferFailed();

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
        emit Deposit(msg.sender, msg.value);
        emit Transfer(address(0), msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        uint256 bal = balanceOf[msg.sender];
        if (bal < amount) revert InsufficientBalance();

        // Effects before the external call: a reentrant withdraw sees the reduced balance.
        unchecked {
            balanceOf[msg.sender] = bal - amount;
            totalSupply -= amount;
        }

        emit Withdrawal(msg.sender, amount);
        emit Transfer(msg.sender, address(0), amount);

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

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

    function _transfer(address from, address to, uint256 amount) internal {
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = bal - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}
