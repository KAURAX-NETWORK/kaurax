// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Vault} from "../src/Vault.sol";

/// @notice Deploy Vault to KAURAX.
///
///   forge script script/Deploy.s.sol --rpc-url $KAURAX_RPC_URL --broadcast
///
/// @dev `forge script` prints simulated addresses even when the broadcast reverts, so read
///      the broadcast summary, not just the log line. That mistake once left three KAURAX
///      roles pointing at addresses that held no code.
contract Deploy is Script {
    function run() external returns (Vault vault) {
        uint256 key = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(key);
        vault = new Vault();
        vm.stopBroadcast();

        console.log("Vault deployed to", address(vault));
        require(address(vault).code.length > 0, "deployment produced no code");
    }
}
