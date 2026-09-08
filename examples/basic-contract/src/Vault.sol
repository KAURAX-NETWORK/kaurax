// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice A deposit book: hold KAX for depositors and let them withdraw their own balance.
///
/// @dev Small on purpose, but not toy-small — it has the two properties a real contract has
///      and an example usually skips: it holds value, and it can be attacked. The withdrawal
///      path writes state before transferring, so a re-entrant caller finds a zero balance.
///      `test/Vault.t.sol` proves that with an actual attacker contract rather than asserting
///      the intent.
contract Vault {
    mapping(address => uint256) public balanceOf;
    uint256 public totalDeposited;

    event Deposited(address indexed who, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed who, uint256 amount, uint256 newBalance);

    error NothingToWithdraw();
    error AmountTooLarge(uint256 requested, uint256 available);
    error TransferFailed();

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        totalDeposited += msg.value;
        emit Deposited(msg.sender, msg.value, balanceOf[msg.sender]);
    }

    function withdraw(uint256 _amount) external {
        uint256 balance = balanceOf[msg.sender];
        if (balance == 0) revert NothingToWithdraw();
        if (_amount > balance) revert AmountTooLarge(_amount, balance);

        // Effects before interaction. Reversing these two lines is the classic re-entrancy
        // bug, and `test_reentrancyCannotDrainTheVault` is what catches it.
        balanceOf[msg.sender] = balance - _amount;
        totalDeposited -= _amount;
        emit Withdrawn(msg.sender, _amount, balanceOf[msg.sender]);

        (bool ok,) = payable(msg.sender).call{value: _amount}("");
        if (!ok) revert TransferFailed();
    }
}
