// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {KauraxNames} from "../src/apps/KauraxNames.sol";
import {WKAX} from "../src/apps/WKAX.sol";
import {KauraxSwapFactory} from "../src/apps/KauraxSwapFactory.sol";
import {KauraxSwapRouter} from "../src/apps/KauraxSwapRouter.sol";
import {KauraxLaunchpad} from "../src/apps/KauraxLaunchpad.sol";

/// @notice Deploys the KAURAX application contracts — Names, Swap and Launchpad — onto KAURAX.
///
/// Usage:
///   export KAURAX_PRIVATE_KEY=0x...        # export at the shell; never commit
///   forge script script/DeployApps.s.sol:DeployApps --rpc-url $KAURAX_RPC_URL --broadcast
///
/// Every parameter comes from the environment. The addresses are written to
/// deployments/apps-<chainid>.json for the devnet script, the API and the frontends to read.
contract DeployApps is Script {
    function run() external {
        uint256 key = vm.envUint("KAURAX_PRIVATE_KEY");
        address deployer = vm.addr(key);

        // Registration fees go here. Defaults to the deployer on a devnet; a public
        // deployment should point this at a multisig.
        address treasury = vm.envOr("KAURAX_NAMES_TREASURY", deployer);

        // Price per year, per label length. KAX has no monetary value, so these are
        // spam resistance rather than revenue.
        uint256 price3 = vm.envOr("KAURAX_NAMES_PRICE_3", uint256(1 ether));
        uint256 price4 = vm.envOr("KAURAX_NAMES_PRICE_4", uint256(0.3 ether));
        uint256 price5 = vm.envOr("KAURAX_NAMES_PRICE_5PLUS", uint256(0.05 ether));

        vm.startBroadcast(key);

        KauraxNames names = new KauraxNames(treasury, price3, price4, price5);
        WKAX wkax = new WKAX();
        KauraxSwapFactory factory = new KauraxSwapFactory();
        KauraxSwapRouter router = new KauraxSwapRouter(address(factory), address(wkax));
        KauraxLaunchpad launchpad = new KauraxLaunchpad();

        vm.stopBroadcast();

        console2.log("KAURAX_NAMES_ADDRESS=%s", address(names));
        console2.log("KAURAX_WKAX_ADDRESS=%s", address(wkax));
        console2.log("KAURAX_SWAP_FACTORY_ADDRESS=%s", address(factory));
        console2.log("KAURAX_SWAP_ROUTER_ADDRESS=%s", address(router));
        console2.log("KAURAX_LAUNCHPAD_ADDRESS=%s", address(launchpad));

        string memory json = "apps";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeUint(json, "deployedAtBlock", block.number);
        vm.serializeAddress(json, "names", address(names));
        vm.serializeAddress(json, "wkax", address(wkax));
        vm.serializeAddress(json, "swapFactory", address(factory));
        vm.serializeAddress(json, "swapRouter", address(router));
        string memory out = vm.serializeAddress(json, "launchpad", address(launchpad));

        vm.writeJson(out, string.concat("./deployments/apps-", vm.toString(block.chainid), ".json"));
    }
}
