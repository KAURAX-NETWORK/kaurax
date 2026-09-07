// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {KauraxDisputeGame} from "../src/dispute/KauraxDisputeGame.sol";
import {KauraxL2OutputOracle} from "../src/L2/KauraxL2OutputOracle.sol";

/// @notice Deploys the dispute game and, optionally, hands it the challenger role.
///
/// Usage:
///   KAURAX_OUTPUT_ORACLE_ADDRESS=0x… KAURAX_GUARDIAN=0x… \
///   forge script script/DeployDisputeGame.s.sol:DeployDisputeGame --rpc-url $L2_RPC_URL --broadcast
///
/// Transferring the challenger role is the point of this deployment: until it happens, a
/// single key can still delete output roots and the game is decoration. It is nevertheless
/// opt-in, because it is irreversible from the deployer's side — set
/// DISPUTE_TRANSFER_CHALLENGER=true once the addresses have been checked.
contract DeployDisputeGame is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address oracle = vm.envAddress("KAURAX_OUTPUT_ORACLE_ADDRESS");

        // The guardian should be the multisig, or a timelock in front of it. Defaulting to
        // an EOA would quietly recreate the single-key problem this contract exists to fix.
        address guardian = vm.envAddress("KAURAX_GUARDIAN");

        uint256 challengerBond = vm.envOr("DISPUTE_CHALLENGER_BOND", uint256(0.1 ether));
        uint256 proposerBond = vm.envOr("DISPUTE_PROPOSER_BOND", uint256(1 ether));
        uint64 responseTimeout = uint64(vm.envOr("DISPUTE_RESPONSE_TIMEOUT", uint256(6 hours)));
        uint64 maxDuration = uint64(vm.envOr("DISPUTE_MAX_DURATION", uint256(30 days)));
        bool transferRole = vm.envOr("DISPUTE_TRANSFER_CHALLENGER", false);

        uint256 finalization = KauraxL2OutputOracle(oracle).finalizationPeriodSeconds();
        if (responseTimeout >= finalization) {
            revert(
                "DISPUTE_RESPONSE_TIMEOUT must be shorter than the oracle's finalization period, "
                "or a single move can outlast the window the dispute protects"
            );
        }

        vm.startBroadcast(deployerKey);

        KauraxDisputeGame game =
            new KauraxDisputeGame(oracle, guardian, challengerBond, proposerBond, responseTimeout, maxDuration);

        console2.log("KAURAX_DISPUTE_GAME_ADDRESS=%s", address(game));
        console2.log("  guardian            %s", guardian);
        console2.log("  challenger bond     %s wei", challengerBond);
        console2.log("  proposer bond       %s wei", proposerBond);
        console2.log("  response timeout    %s s", responseTimeout);
        console2.log("  finalization period %s s", finalization);

        if (transferRole) {
            KauraxL2OutputOracle(oracle).setChallenger(address(game));
            console2.log("  oracle.challenger -> dispute game (deletion is now permissionless to trigger)");
        } else {
            console2.log("");
            console2.log("Challenger role NOT transferred. The game is deployed but inert:");
            console2.log("a single key can still delete output roots. Re-run with");
            console2.log("DISPUTE_TRANSFER_CHALLENGER=true once you have checked the addresses.");
        }

        vm.stopBroadcast();

        console2.log("");
        console2.log("This is NOT a fault proof system. The guardian decides every narrowed");
        console2.log("dispute. See docs/DISPUTE_GAME.md and docs/FAULT_PROOF_SPEC.md.");
    }
}
