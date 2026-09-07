// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeployGuard} from "../src/libraries/DeployGuard.sol";

/// @dev External wrapper so expectRevert sees a real call frame rather than an inlined one.
contract GuardHarness {
    function mustHaveCode(address t, string calldata role) external view {
        DeployGuard.mustHaveCode(t, role);
    }

    function mustBeDeployed(address t, string calldata what) external view {
        DeployGuard.mustBeDeployed(t, what);
    }

    function hasCode(address t) external view returns (bool) {
        return DeployGuard.hasCode(t);
    }
}

contract Dummy {
    uint256 public x;
}

/// @notice Regression tests for the deployment mistake described in DeployGuard.
///
/// @dev The scenario, concretely: forge prints an address from a simulation, the broadcast
///      reverts, nothing is deployed there, and a role is assigned to it anyway. Because a
///      role may only be rotated by its current holder, that is unrecoverable. These tests
///      pin the check that makes it impossible.
contract DeployGuardTest is Test {
    GuardHarness internal guard;
    Dummy internal deployed;

    function setUp() public {
        guard = new GuardHarness();
        deployed = new Dummy();
    }

    function test_acceptsALiveContract() public view {
        guard.mustHaveCode(address(deployed), "guardian");
        assertTrue(guard.hasCode(address(deployed)));
    }

    /// @dev The exact failure: an address that looks plausible and holds nothing.
    function test_rejectsAnAddressFromARevertedDeployment() public {
        address simulated = address(0xd80a4C2ee40a87F1329D8B24AA267b7F0B9BE6E0);
        assertEq(simulated.code.length, 0, "precondition: no code");

        vm.expectRevert(abi.encodeWithSelector(DeployGuard.NotAContract.selector, simulated, "guardian"));
        guard.mustHaveCode(simulated, "guardian");
    }

    function test_rejectsTheZeroAddress() public {
        vm.expectRevert(abi.encodeWithSelector(DeployGuard.ZeroAddress.selector, "challenger"));
        guard.mustHaveCode(address(0), "challenger");
    }

    /// @dev An EOA is a live account with a balance and no code. Roles must not go to one:
    ///      a multisig that is secretly an EOA is a single key wearing a costume.
    function test_rejectsAnEoaEvenWithBalance() public {
        address eoa = address(0xBEEF);
        vm.deal(eoa, 100 ether);
        assertEq(eoa.code.length, 0);

        vm.expectRevert(abi.encodeWithSelector(DeployGuard.NotAContract.selector, eoa, "owner"));
        guard.mustHaveCode(eoa, "owner");
        assertFalse(guard.hasCode(eoa));
    }

    function test_mustBeDeployedAcceptsAFreshDeployment() public {
        Dummy fresh = new Dummy();
        guard.mustBeDeployed(address(fresh), "KauraxMultisig");
    }

    function test_mustBeDeployedRejectsNothing() public {
        vm.expectRevert(abi.encodeWithSelector(DeployGuard.NotAContract.selector, address(0), "KauraxMultisig"));
        guard.mustBeDeployed(address(0), "KauraxMultisig");
    }

    /// @dev The revert names the role, so an operator reading a failed deployment knows
    ///      which assignment stopped rather than only that something did.
    function test_revertNamesTheRole() public {
        vm.expectRevert(abi.encodeWithSelector(DeployGuard.NotAContract.selector, address(0x1234), "inbox owner"));
        guard.mustHaveCode(address(0x1234), "inbox owner");
    }

    function testFuzz_onlyContractsPass(address target) public view {
        // hasCode must agree with the EVM, for any address, with no exceptions carved out.
        assertEq(guard.hasCode(target), target != address(0) && target.code.length > 0);
    }
}
