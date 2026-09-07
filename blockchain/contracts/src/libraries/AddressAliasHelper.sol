// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title AddressAliasHelper
/// @notice Applies the standard L1->L2 style address alias when a contract initiates a
///         cross-domain deposit.
///
/// @dev Without aliasing, a contract on the L2 whose address happens to match an EOA the
///      attacker controls on L3 could impersonate that account across the bridge. Adding a
///      fixed offset makes the L3-side sender provably distinct from any address the
///      sender could hold a key for. Same constant as the OP Stack / Arbitrum convention.
library AddressAliasHelper {
    uint160 internal constant OFFSET = uint160(0x1111000000000000000000000000000000001111);

    function applyAliasIfContract(address _address) internal view returns (address) {
        // EOAs are passed through: they cannot be impersonated by a contract deployment.
        if (_address.code.length == 0) return _address;
        return applyAlias(_address);
    }

    function applyAlias(address _address) internal pure returns (address aliased) {
        unchecked {
            aliased = address(uint160(_address) + OFFSET);
        }
    }

    function undoAlias(address _address) internal pure returns (address original) {
        unchecked {
            original = address(uint160(_address) - OFFSET);
        }
    }
}
