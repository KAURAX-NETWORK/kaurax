// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {KauraxMultisig} from "../src/governance/KauraxMultisig.sol";
import {KauraxTimelock} from "../src/governance/KauraxTimelock.sol";
import {KauraxL2OutputOracle} from "../src/L2/KauraxL2OutputOracle.sol";
import {KauraxPortal} from "../src/L2/KauraxPortal.sol";
import {KauraxBatchInbox} from "../src/L2/KauraxBatchInbox.sol";
import {KauraxDisputeGame} from "../src/dispute/KauraxDisputeGame.sol";

/// @notice Deploys governance and hands the privileged roles to it.
///
/// Usage:
///   GOV_OWNERS=0xaaa,0xbbb,0xccc GOV_THRESHOLD=2 \
///   forge script script/DeployGovernance.s.sol:DeployGovernance --rpc-url $L2_RPC_URL --broadcast
///
/// Two shapes of authority, chosen per role for a reason:
///
///   guardian    -> multisig directly.  Pausing must be immediate. A guardian that has to
///                  wait out a timelock before pausing a live exploit is decoration.
///   challenger  -> timelock.           Deleting a proposed output root rewrites settlement
///                  history; it should be visible for the delay before it lands.
///   inbox owner -> timelock.           Changing who may submit batches is a change to who
///                  controls the chain's data availability.
///
/// The timelock's proposer is the multisig, so every delayed action still needs m-of-n.
/// Execution is permissionless (executor = address(0)): once a proposal has waited out its
/// delay in public, anyone may push the button, so governance cannot quietly abandon a
/// queued action it no longer likes without cancelling it visibly.
contract DeployGovernance is Script {
    struct Params {
        address[] owners;
        uint256 threshold;
        uint256 minimumDelay;
        uint256 initialDelay;
        address oracle;
        address portal;
        address inbox;
        bool transferRoles;
    }

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        Params memory p = _params();

        vm.startBroadcast(deployerKey);

        KauraxMultisig multisig = new KauraxMultisig(p.owners, p.threshold);

        // Guardian of the timelock is the multisig too: a queued proposal that turns out to
        // be hostile can be cancelled by the same m-of-n that could have queued it.
        KauraxTimelock timelock = new KauraxTimelock(
            p.minimumDelay,
            p.initialDelay,
            address(multisig), // proposer
            address(0), // executor: permissionless after the delay
            address(multisig) // guardian: may cancel
        );

        console2.log("KAURAX_MULTISIG_ADDRESS=%s", address(multisig));
        console2.log("KAURAX_TIMELOCK_ADDRESS=%s", address(timelock));
        console2.log("  owners: %s, threshold: %s", p.owners.length, p.threshold);
        console2.log("  timelock delay: %s s (minimum %s s, immutable)", p.initialDelay, p.minimumDelay);

        if (p.transferRoles) {
            _transferRoles(p, address(multisig), address(timelock));
        } else {
            console2.log("");
            console2.log("Roles NOT transferred (GOV_TRANSFER_ROLES is not true).");
            console2.log("Deployed governance is inert until you hand it the roles.");
        }

        vm.stopBroadcast();

        _report(p, address(multisig), address(timelock));
    }

    /// @dev Each transfer is one-way from the deployer's point of view: after this runs,
    ///      the deploying key can no longer perform these actions. That is the point.
    function _transferRoles(Params memory p, address multisig, address timelock) internal {
        if (p.portal != address(0)) {
            KauraxPortal(payable(p.portal)).setGuardian(multisig);
            console2.log("portal.guardian    -> multisig %s", multisig);
        }
        if (p.oracle != address(0)) {
            // Only if the challenger is still a plain key. Once a dispute game holds it,
            // deleting an output root is the outcome of a played game rather than an act of
            // authority, and handing the role to a timelock would quietly undo that — a
            // downgrade dressed as a governance upgrade.
            //
            // Where a game is wired in, governance takes the game's guardian role instead,
            // which is set separately with KAURAX_DISPUTE_GAME_ADDRESS.
            if (KauraxL2OutputOracle(p.oracle).disputeGameEnforced()) {
                console2.log("oracle.challenger  -> unchanged (a dispute game holds it)");
            } else {
                KauraxL2OutputOracle(p.oracle).setChallenger(timelock);
                console2.log("oracle.challenger  -> timelock %s", timelock);
            }
        }

        // The role that matters most for the trust model: whoever resolves a dispute is the
        // final arbiter, and it should not be one key.
        address game = vm.envOr("KAURAX_DISPUTE_GAME_ADDRESS", address(0));
        if (game != address(0)) {
            KauraxDisputeGame(payable(game)).setGuardian(multisig);
            console2.log("disputeGame.guardian -> multisig %s", multisig);
        }
        if (p.inbox != address(0)) {
            KauraxBatchInbox(p.inbox).setOwner(timelock);
            console2.log("inbox.owner        -> timelock %s", timelock);
        }
    }

    function _params() internal view returns (Params memory p) {
        p.owners = vm.envAddress("GOV_OWNERS", ",");
        p.threshold = vm.envOr("GOV_THRESHOLD", uint256(0));

        if (p.owners.length == 0) {
            revert("GOV_OWNERS is empty. Set it to a comma-separated list of owner addresses.");
        }
        if (p.threshold == 0) {
            // Default to a genuine majority rather than 1-of-n, which is a single key with
            // extra steps.
            p.threshold = p.owners.length / 2 + 1;
        }
        if (p.threshold > p.owners.length) {
            revert("GOV_THRESHOLD exceeds the number of owners.");
        }

        // 48 hours by default: long enough that users can see a change coming and exit,
        // short enough to remain operable. MINIMUM_DELAY is immutable in the timelock, so
        // this floor cannot be lowered later by governance itself.
        p.minimumDelay = vm.envOr("GOV_MINIMUM_DELAY", uint256(48 hours));
        p.initialDelay = vm.envOr("GOV_INITIAL_DELAY", p.minimumDelay);

        p.oracle = vm.envOr("KAURAX_OUTPUT_ORACLE_ADDRESS", address(0));
        p.portal = vm.envOr("KAURAX_PORTAL_ADDRESS", address(0));
        p.inbox = vm.envOr("KAURAX_BATCH_INBOX_ADDRESS", address(0));
        p.transferRoles = vm.envOr("GOV_TRANSFER_ROLES", false);
    }

    function _report(Params memory p, address multisig, address timelock) internal {
        string memory json = string.concat(
            "{\n",
            '  "chainId": ',
            vm.toString(block.chainid),
            ",\n",
            '  "multisig": "',
            vm.toString(multisig),
            '",\n',
            '  "timelock": "',
            vm.toString(timelock),
            '",\n',
            '  "threshold": ',
            vm.toString(p.threshold),
            ",\n",
            '  "owners": ',
            vm.toString(p.owners.length),
            ",\n",
            '  "minimumDelaySeconds": ',
            vm.toString(p.minimumDelay),
            ",\n",
            '  "initialDelaySeconds": ',
            vm.toString(p.initialDelay),
            ",\n",
            '  "rolesTransferred": ',
            p.transferRoles ? "true" : "false",
            "\n}\n"
        );
        vm.writeFile(string.concat("deployments/governance-", vm.toString(block.chainid), ".json"), json);

        console2.log("");
        console2.log("Wrote deployments/governance-%s.json", vm.toString(block.chainid));
        if (!p.transferRoles) {
            console2.log("Next: re-run with GOV_TRANSFER_ROLES=true once you have verified the addresses.");
        }
    }
}
