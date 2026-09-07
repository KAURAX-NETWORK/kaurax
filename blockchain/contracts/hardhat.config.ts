/**
 * Hardhat configuration for KAURAX.
 *
 * Foundry is the primary toolchain in this repository (see foundry.toml), but KAURAX is
 * EVM-equivalent and Hardhat works without adaptation. Both are provided so neither is a
 * prerequisite.
 *
 * Setup:
 *   npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
 *   export KAURAX_RPC_URL=http://127.0.0.1:8420
 *   export KAURAX_CHAIN_ID=8420
 *   export KAURAX_PRIVATE_KEY=0x...      # export at the shell — never commit a key
 *
 *   npx hardhat compile
 *   npx hardhat run scripts/deploy.ts --network kaurax
 */
import type {HardhatUserConfig} from "hardhat/config";

/** Only include an account when one was actually provided. An empty array is correct otherwise. */
function accounts(envVar: string): string[] {
  const key = process.env[envVar];
  if (!key) return [];
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`${envVar} is not a valid 32-byte hex private key.`);
  }
  return [key];
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {enabled: true, runs: 999999},
      evmVersion: "cancun",
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache-hardhat",
    artifacts: "./artifacts",
  },
  networks: {
    kaurax: {
      url: process.env.KAURAX_RPC_URL ?? "http://127.0.0.1:8420",
      chainId: Number(process.env.KAURAX_CHAIN_ID ?? 8420),
      accounts: accounts("KAURAX_PRIVATE_KEY"),
    },
    // The underlying L2, for deploying and interacting with the settlement contracts.
    l2: {
      url: process.env.L2_RPC_URL ?? "http://127.0.0.1:9545",
      chainId: Number(process.env.L2_CHAIN_ID ?? 8415),
      accounts: accounts("DEPLOYER_PRIVATE_KEY"),
    },
  },
};

export default config;
