// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {KauraxL2OutputOracle} from "../src/L2/KauraxL2OutputOracle.sol";
import {KauraxPortal} from "../src/L2/KauraxPortal.sol";
import {KauraxBatchInbox} from "../src/L2/KauraxBatchInbox.sol";
import {KauraxL2ERC20Bridge} from "../src/L2/KauraxL2ERC20Bridge.sol";

/// @notice Deploys the KAURAX settlement contracts onto the underlying L2.
///
/// Usage:
///   forge script script/DeploySettlement.s.sol:DeploySettlement \
///     --rpc-url $L2_RPC_URL --broadcast
///
/// Every parameter comes from the environment; nothing is hardcoded. The resulting
/// addresses are written to deployments/<chainid>.json for the node and explorer to read.
contract DeploySettlement is Script {
    /// @dev Fixed KAURAX L3 predeploy address of the ERC-20 bridge. The L2 bridge must
    ///      know its counterpart at construction, and the counterpart's address is a
    ///      genesis constant rather than a deployment output.
    address internal constant L3_ERC20_BRIDGE_PREDEPLOY = 0x4200000000000000000000000000000000000010;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        // Grouped into a struct: the deployment needs more parameters than the EVM's
        // reachable stack depth allows as separate locals.
        Config memory cfg = _config(deployerKey);

        vm.startBroadcast(deployerKey);

        KauraxL2OutputOracle oracle = new KauraxL2OutputOracle(
            cfg.submissionInterval,
            cfg.l3BlockTime,
            cfg.startingBlockNumber,
            block.timestamp,
            cfg.finalizationPeriod,
            cfg.proposer,
            cfg.challenger,
            cfg.proposerBond
        );

        KauraxPortal portal =
            new KauraxPortal(address(oracle), cfg.guardian, cfg.sequencer, cfg.forcedInclusionWindow);
        KauraxBatchInbox inbox = new KauraxBatchInbox(vm.addr(deployerKey), cfg.batcher);
        KauraxL2ERC20Bridge l2Bridge = new KauraxL2ERC20Bridge(address(portal), L3_ERC20_BRIDGE_PREDEPLOY);

        // Wire forced-inclusion enforcement. Done after both exist, because the portal
        // needs the oracle at construction and the oracle needs the portal afterwards.
        // From here, the oracle refuses output proposals while a forced transaction is
        // overdue — censoring one user halts settlement for everyone.
        oracle.setForcedInclusion(address(portal));

        vm.stopBroadcast();

        console2.log("KAURAX_OUTPUT_ORACLE_ADDRESS=%s", address(oracle));
        console2.log("KAURAX_PORTAL_ADDRESS=%s", address(portal));
        console2.log("KAURAX_BATCH_INBOX_ADDRESS=%s", address(inbox));
        console2.log("KAURAX_L2_BRIDGE_ADDRESS=%s", address(l2Bridge));
        console2.log("forced inclusion window: %s L2 blocks", cfg.forcedInclusionWindow);

        _write(cfg, address(oracle), address(portal), address(inbox), address(l2Bridge));
    }

    struct Config {
        uint256 proposerBond;
        address proposer;
        address batcher;
        address sequencer;
        address guardian;
        address challenger;
        uint256 submissionInterval;
        uint256 l3BlockTime;
        uint256 startingBlockNumber;
        uint256 finalizationPeriod;
        uint256 forcedInclusionWindow;
    }

    function _config(uint256 deployerKey) internal view returns (Config memory cfg) {
        cfg.proposer = vm.addr(vm.envUint("PROPOSER_PRIVATE_KEY"));
        cfg.batcher = vm.addr(vm.envUint("BATCHER_PRIVATE_KEY"));
        cfg.sequencer = vm.addr(vm.envUint("SEQUENCER_PRIVATE_KEY"));

        // The guardian and challenger are privileged operational roles. On a devnet they
        // default to the deployer; a public deployment MUST override them with a
        // KauraxMultisig behind a KauraxTimelock. See docs/security.md.
        cfg.guardian = vm.envOr("GUARDIAN_ADDRESS", vm.addr(deployerKey));
        cfg.challenger = vm.envOr("CHALLENGER_ADDRESS", vm.addr(deployerKey));
        // Escrowed with every output root. Zero is permitted and means the devnet default:
        // proposals carry no stake, which is fine when the chain carries no value and is
        // not fine anywhere else. docs/DISPUTE_GAME.md covers sizing.
        cfg.proposerBond = vm.envOr("PROPOSER_BOND", uint256(0));

        cfg.submissionInterval = vm.envOr("OUTPUT_SUBMISSION_INTERVAL_BLOCKS", uint256(12));
        cfg.l3BlockTime = vm.envOr("KAURAX_BLOCK_TIME", uint256(2));
        cfg.startingBlockNumber = vm.envOr("KAURAX_STARTING_BLOCK", uint256(1));
        cfg.finalizationPeriod = vm.envOr("WITHDRAWAL_CHALLENGE_WINDOW", uint256(120));
        cfg.forcedInclusionWindow = vm.envOr("FORCED_INCLUSION_WINDOW", uint256(300));
    }

    function _write(Config memory cfg, address oracle, address portal, address inbox, address l2Bridge)
        internal
    {
        string memory json = "deployment";
        vm.serializeUint(json, "l2ChainId", block.chainid);
        vm.serializeUint(json, "deployedAtL2Block", block.number);
        vm.serializeUint(json, "deployedAtTimestamp", block.timestamp);
        vm.serializeUint(json, "startingBlockNumber", cfg.startingBlockNumber);
        vm.serializeUint(json, "submissionIntervalBlocks", cfg.submissionInterval);
        vm.serializeUint(json, "finalizationPeriodSeconds", cfg.finalizationPeriod);
        vm.serializeUint(json, "forcedInclusionWindow", cfg.forcedInclusionWindow);
        vm.serializeAddress(json, "proposer", cfg.proposer);
        vm.serializeAddress(json, "batcher", cfg.batcher);
        vm.serializeAddress(json, "sequencer", cfg.sequencer);
        vm.serializeAddress(json, "guardian", cfg.guardian);
        vm.serializeAddress(json, "challenger", cfg.challenger);
        vm.serializeAddress(json, "outputOracle", oracle);
        vm.serializeAddress(json, "portal", portal);
        vm.serializeAddress(json, "batchInbox", inbox);
        vm.serializeAddress(json, "l2ERC20Bridge", l2Bridge);
        string memory out = vm.serializeAddress(json, "l3ERC20BridgePredeploy", L3_ERC20_BRIDGE_PREDEPLOY);

        vm.writeJson(out, string.concat("./deployments/", vm.toString(block.chainid), ".json"));
    }
}
