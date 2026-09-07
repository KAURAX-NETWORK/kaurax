// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "../interfaces/IERC20.sol";

/// @title KauraxBridgedERC20
/// @notice KAURAX-side representation of a token escrowed on the underlying L2.
/// @dev Supply is controlled solely by the L3 bridge: minted on deposit, burned on
///      withdrawal. It is not independently issuable.
contract KauraxBridgedERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;

    /// @notice The only address permitted to mint and burn.
    address public immutable BRIDGE;

    /// @notice The escrowed token on the underlying L2 that this represents.
    address public immutable REMOTE_TOKEN;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Mint(address indexed account, uint256 amount);
    event Burn(address indexed account, uint256 amount);

    error NotBridge();
    error InsufficientBalance();
    error InsufficientAllowance();

    modifier onlyBridge() {
        if (msg.sender != BRIDGE) revert NotBridge();
        _;
    }

    constructor(
        address _bridge,
        address _remoteToken,
        string memory _name,
        string memory _symbol,
        uint8 _decimals
    ) {
        BRIDGE = _bridge;
        REMOTE_TOKEN = _remoteToken;
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address _to, uint256 _amount) external onlyBridge {
        totalSupply += _amount;
        balanceOf[_to] += _amount;
        emit Mint(_to, _amount);
        emit Transfer(address(0), _to, _amount);
    }

    function burn(address _from, uint256 _amount) external onlyBridge {
        uint256 bal = balanceOf[_from];
        if (bal < _amount) revert InsufficientBalance();
        unchecked {
            balanceOf[_from] = bal - _amount;
            totalSupply -= _amount;
        }
        emit Burn(_from, _amount);
        emit Transfer(_from, address(0), _amount);
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
