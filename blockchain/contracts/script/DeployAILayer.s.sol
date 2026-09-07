// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {AIServiceRegistry} from "../src/ai/AIServiceRegistry.sol";
import {AIAgentRegistry} from "../src/ai/AIAgentRegistry.sol";
import {AIPayments} from "../src/ai/AIPayments.sol";

/// @notice Deploys the optional KAURAX AI application layer onto KAURAX.
/// @dev These are application contracts, not protocol components. Nothing else in KAURAX
///      depends on them. See docs/ai.md for what they do and do not guarantee.
contract DeployAILayer is Script {
    function run() external {
        uint256 key = vm.envUint("KAURAX_PRIVATE_KEY");

        vm.startBroadcast(key);
        AIServiceRegistry services = new AIServiceRegistry();
        AIAgentRegistry agents = new AIAgentRegistry();
        AIPayments payments = new AIPayments(address(services));
        vm.stopBroadcast();

        console2.log("AIServiceRegistry %s", address(services));
        console2.log("AIAgentRegistry   %s", address(agents));
        console2.log("AIPayments        %s", address(payments));
    }
}
