// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal state-mutating contract, useful for gas and throughput measurement.
contract Counter {
    uint256 public number;

    event NumberChanged(uint256 previous, uint256 current);

    function setNumber(uint256 _newNumber) public {
        emit NumberChanged(number, _newNumber);
        number = _newNumber;
    }

    function increment() public {
        uint256 prev = number;
        unchecked {
            number = prev + 1;
        }
        emit NumberChanged(prev, number);
    }
}
