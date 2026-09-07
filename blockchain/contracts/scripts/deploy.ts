/**
 * Hardhat deployment example for KAURAX.
 *   npx hardhat run scripts/deploy.ts --network kaurax
 */
import hre from "hardhat";

async function main(): Promise<void> {
  const network = await hre.ethers.provider.getNetwork();
  console.log(`deploying to chain ${network.chainId}`);

  const expected = BigInt(process.env.KAURAX_CHAIN_ID ?? 8420);
  if (network.chainId !== expected) {
    throw new Error(`connected to chain ${network.chainId}, expected KAURAX (${expected})`);
  }

  const factory = await hre.ethers.getContractFactory("HelloKaurax");
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`HelloKaurax deployed at ${address}`);
  console.log(`contract sees chain id ${await contract.chainId()}`);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
