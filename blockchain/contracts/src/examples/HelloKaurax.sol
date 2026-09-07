// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Smallest useful contract on KAURAX. Deploy it to confirm your toolchain,
///         RPC URL and chain ID are wired up correctly.
contract HelloKaurax {
    string public greeting = "Hello from KAURAX L3";
    address public lastCaller;
    uint256 public greetCount;

    event Greeted(address indexed caller, string greeting, uint256 count);

    function greet() external returns (string memory) {
        lastCaller = msg.sender;
        unchecked {
            greetCount++;
        }
        emit Greeted(msg.sender, greeting, greetCount);
        return greeting;
    }

    function setGreeting(string calldata _greeting) external {
        greeting = _greeting;
    }

    /// @notice The chain ID this contract sees. On KAURAX devnet this returns 8420.
    function chainId() external view returns (uint256) {
        return block.chainid;
    }
}
