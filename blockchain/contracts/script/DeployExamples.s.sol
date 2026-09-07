// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {HelloKaurax} from "../src/examples/HelloKaurax.sol";
import {Counter} from "../src/examples/Counter.sol";
import {SimpleStorage} from "../src/examples/SimpleStorage.sol";
import {KauraxToken} from "../src/examples/KauraxToken.sol";

/// @notice Deploys the example contracts onto KAURAX.
///
/// Usage:
///   export KAURAX_PRIVATE_KEY=0x...    # export at the shell; never commit
///   forge script script/DeployExamples.s.sol:DeployExamples \
///     --rpc-url $KAURAX_RPC_URL --broadcast
contract DeployExamples is Script {
    function run() external {
        uint256 key = vm.envUint("KAURAX_PRIVATE_KEY");

        vm.startBroadcast(key);

        HelloKaurax hello = new HelloKaurax();
        Counter counter = new Counter();
        SimpleStorage storage_ = new SimpleStorage();
        // An EXAMPLE ERC-20. This is not KAX, which is the native currency of the chain.
        KauraxToken token = new KauraxToken("Example Token", "EXMPL", 18, 1_000_000e18);

        vm.stopBroadcast();

        console2.log("chain id      %s", block.chainid);
        console2.log("HelloKaurax   %s", address(hello));
        console2.log("Counter       %s", address(counter));
        console2.log("SimpleStorage %s", address(storage_));
        console2.log("KauraxToken   %s", address(token));
    }
}
