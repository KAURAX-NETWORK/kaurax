// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vault} from "../src/Vault.sol";

contract VaultTest is Test {
    Vault internal vault;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        vault = new Vault();
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    function test_depositCreditsTheDepositor() public {
        vm.prank(alice);
        vault.deposit{value: 1 ether}();
        assertEq(vault.balanceOf(alice), 1 ether);
        assertEq(vault.totalDeposited(), 1 ether);
    }

    function test_withdrawReturnsValue() public {
        vm.prank(alice);
        vault.deposit{value: 2 ether}();

        uint256 before = alice.balance;
        vm.prank(alice);
        vault.withdraw(1 ether);

        assertEq(alice.balance - before, 1 ether);
        assertEq(vault.balanceOf(alice), 1 ether);
    }

    function test_cannotWithdrawSomeoneElsesBalance() public {
        vm.prank(alice);
        vault.deposit{value: 1 ether}();

        vm.prank(bob);
        vm.expectRevert(Vault.NothingToWithdraw.selector);
        vault.withdraw(1 ether);
    }

    function test_cannotWithdrawMoreThanDeposited() public {
        vm.prank(alice);
        vault.deposit{value: 1 ether}();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Vault.AmountTooLarge.selector, 2 ether, 1 ether));
        vault.withdraw(2 ether);
    }

    /// @notice A real attacker contract, not an assertion about intent.
    function test_reentrancyCannotDrainTheVault() public {
        vm.prank(alice);
        vault.deposit{value: 5 ether}();

        Reentrant attacker = new Reentrant(vault);
        // Funded only by the call below. An earlier version also called `vm.deal` here, so
        // the attacker started with a spare ether and the final assertion was off by exactly
        // that — the test was wrong, not the vault.
        attacker.seed{value: 1 ether}();
        assertEq(address(attacker).balance, 0, "everything it had went into the vault");

        attacker.attack();

        // It gets back exactly what it put in, and Alice's deposit is untouched.
        assertEq(address(attacker).balance, 1 ether);
        assertEq(vault.balanceOf(alice), 5 ether);
        assertEq(address(vault).balance, 5 ether);
    }

    function testFuzz_depositThenWithdrawIsAlwaysNeutral(uint96 _amount) public {
        vm.assume(_amount > 0);
        vm.deal(alice, _amount);

        uint256 before = alice.balance;
        vm.startPrank(alice);
        vault.deposit{value: _amount}();
        vault.withdraw(_amount);
        vm.stopPrank();

        assertEq(alice.balance, before);
        assertEq(vault.balanceOf(alice), 0);
    }
}

/// @dev Tries to withdraw again from inside the transfer it is being paid by.
contract Reentrant {
    Vault internal immutable VAULT;
    bool internal reentered;

    constructor(Vault _vault) {
        VAULT = _vault;
    }

    function seed() external payable {
        VAULT.deposit{value: msg.value}();
    }

    function attack() external {
        VAULT.withdraw(1 ether);
    }

    receive() external payable {
        if (!reentered) {
            reentered = true;
            // Balance is already zero by the time this runs, so the vault refuses.
            try VAULT.withdraw(1 ether) {} catch {}
        }
    }
}
