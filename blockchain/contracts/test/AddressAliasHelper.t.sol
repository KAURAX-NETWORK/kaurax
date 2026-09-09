// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AddressAliasHelper} from "../src/libraries/AddressAliasHelper.sol";

/// @notice Aliasing is what stops an L2 contract impersonating an L3 account across the
///         bridge. `KauraxL3ERC20Bridge.finalizeDeposit` trusts exactly one caller — the
///         aliased L2 bridge — so the arithmetic here is an access-control primitive.
contract AddressAliasHelperTest is Test {
    address internal constant OFFSET = 0x1111000000000000000000000000000000001111;

    function test_applyAliasAddsTheStandardOffset() public pure {
        assertEq(
            AddressAliasHelper.applyAlias(address(0)),
            OFFSET,
            "the offset must match the OP Stack / Arbitrum convention"
        );
    }

    function testFuzz_undoAliasInvertsApplyAlias(address a) public pure {
        assertEq(AddressAliasHelper.undoAlias(AddressAliasHelper.applyAlias(a)), a);
    }

    function testFuzz_applyAliasInvertsUndoAlias(address a) public pure {
        assertEq(AddressAliasHelper.applyAlias(AddressAliasHelper.undoAlias(a)), a);
    }

    /// The whole point: no address is its own alias, so an aliased sender can never be
    /// mistaken for the address it came from.
    function testFuzz_anAddressIsNeverItsOwnAlias(address a) public pure {
        assertTrue(AddressAliasHelper.applyAlias(a) != a);
    }

    /// Aliasing is `unchecked`, so addresses near the top of the range wrap. That is
    /// intended and harmless — but it must still round-trip, or a high-addressed L2 bridge
    /// would be unable to authenticate.
    function test_aliasWrapsAtTheTopOfTheRangeAndStillRoundTrips() public pure {
        address high = address(type(uint160).max);
        address aliased = AddressAliasHelper.applyAlias(high);
        assertTrue(uint160(aliased) < uint160(high), "expected the addition to wrap");
        assertEq(AddressAliasHelper.undoAlias(aliased), high);
    }

    /// EOAs pass through: a contract cannot be deployed at an address that already holds a
    /// key, so there is nothing to impersonate.
    function test_applyAliasIfContractPassesThroughAnEoa() public {
        address eoa = makeAddr("eoa");
        assertEq(AddressAliasHelper.applyAliasIfContract(eoa), eoa);
    }

    function test_applyAliasIfContractAliasesAContract() public {
        Dummy d = new Dummy();
        assertEq(
            AddressAliasHelper.applyAliasIfContract(address(d)), AddressAliasHelper.applyAlias(address(d))
        );
    }

    /// Distinct senders must alias to distinct addresses, or two L2 contracts would share
    /// one L3 identity.
    function testFuzz_aliasingIsInjective(address a, address b) public pure {
        vm.assume(a != b);
        assertTrue(AddressAliasHelper.applyAlias(a) != AddressAliasHelper.applyAlias(b));
    }
}

contract Dummy {
    uint256 public x;
}
