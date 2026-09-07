// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "../interfaces/IERC20.sol";

/// @notice A plain ERC-20 for testing on KAURAX.
/// @dev This is an EXAMPLE token, not the KAX gas asset. KAX is the native currency of
///      the chain and is not an ERC-20. Neither has monetary value.
contract KauraxToken is IERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;

    address public owner;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    error NotOwner();
    error InsufficientBalance();
    error InsufficientAllowance();

    constructor(string memory _name, string memory _symbol, uint8 _decimals, uint256 _initialSupply) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        owner = msg.sender;
        if (_initialSupply > 0) {
            totalSupply = _initialSupply;
            balanceOf[msg.sender] = _initialSupply;
            emit Transfer(address(0), msg.sender, _initialSupply);
        }
    }

    function mint(address _to, uint256 _amount) external {
        if (msg.sender != owner) revert NotOwner();
        totalSupply += _amount;
        balanceOf[_to] += _amount;
        emit Transfer(address(0), _to, _amount);
    }

    function transfer(address _to, uint256 _amount) external returns (bool) {
        _transfer(msg.sender, _to, _amount);
        return true;
    }

    function approve(address _spender, uint256 _amount) external returns (bool) {
        allowance[msg.sender][_spender] = _amount;
        emit Approval(msg.sender, _spender, _amount);
        return true;
    }

    function transferFrom(address _from, address _to, uint256 _amount) external returns (bool) {
        uint256 allowed = allowance[_from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < _amount) revert InsufficientAllowance();
            unchecked {
                allowance[_from][msg.sender] = allowed - _amount;
            }
        }
        _transfer(_from, _to, _amount);
        return true;
    }

    function _transfer(address _from, address _to, uint256 _amount) internal {
        uint256 bal = balanceOf[_from];
        if (bal < _amount) revert InsufficientBalance();
        unchecked {
            balanceOf[_from] = bal - _amount;
            balanceOf[_to] += _amount;
        }
        emit Transfer(_from, _to, _amount);
    }
}
