import { network } from "hardhat";
import { formatEther, getAddress, maxUint128, parseEther, type Address, zeroAddress } from "viem";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertKeyIsSafeForChain,
  explorerAddressUrl,
  getChain,
  type DeploymentFile,
  type DeploymentQuoteAsset,
} from "@portus/shared";
import { createDemoLaunch } from "./lib/launch.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

function confirmed(): boolean {
  return process.argv.includes("--confirm") || process.env.DEPLOY_CONFIRM === "yes";
}

function gitCommit(): string | null {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
  } catch {
    return null;
  }
}

async function main() {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const chain = getChain(chainId);

  // Mainnets hold real funds and every contract here is immutable. Refuse until
  // an external audit is done and the operator says so explicitly.
  if (chain.requiresAudit && process.env.PORTUS_MAINNET_AUDITED !== "yes") {
    throw new Error(
      `REFUSING TO DEPLOY Portus to ${chain.displayName} (chain ${chainId}).\n` +
        `The contracts are not externally audited and cannot be upgraded or paused.\n` +
        `After an audit, set PORTUS_MAINNET_AUDITED=yes to proceed.`,
    );
  }

  const [deployer] = await viem.getWalletClients();
  if (!deployer) throw new Error(`No signer for ${chain.displayName}. Set DEPLOYER_PRIVATE_KEY in .env.`);
  const deployerAddress = deployer.account.address;
  assertKeyIsSafeForChain(deployerAddress, chainId);

  const quoteAdminEnv = process.env.PORTUS_QUOTE_ADMIN;
  if (!chain.isLocal && !quoteAdminEnv) {
    throw new Error("Set PORTUS_QUOTE_ADMIN (the multisig that curates quote assets) before a public deployment.");
  }
  const quoteAdmin = (quoteAdminEnv ? getAddress(quoteAdminEnv) : deployerAddress) as Address;
  // Ecosystem fee recipient and Merkle root publisher are written into the
  // factory for good; on public networks they must be explicit multisigs.
  const roleEnv = (name: string) => {
    const v = process.env[name];
    if (!chain.isLocal && !v) throw new Error(`Set ${name} before a public deployment.`);
    return (v ? getAddress(v) : deployerAddress) as Address;
  };
  const ecosystem = roleEnv("PORTUS_ECOSYSTEM");
  const rootPublisher = roleEnv("PORTUS_ROOT_PUBLISHER");

  const balance = await publicClient.getBalance({ address: deployerAddress });
  console.log(`network:     ${chain.displayName} (chain ${chainId})`);
  console.log(`deployer:    ${deployerAddress}  (${formatEther(balance)} ETH)`);
  console.log(`quoteAdmin:  ${quoteAdmin}`);
  console.log(`ecosystem:   ${ecosystem}`);
  console.log(`publisher:   ${rootPublisher}`);

  if (!chain.isLocal) {
    if (!confirmed()) {
      console.log(
        `\nThis is a public network. Re-run with --confirm (or DEPLOY_CONFIRM=yes) after\n` +
          `checking the parameters above. Nothing has been sent.`,
      );
      return;
    }
  }

  const confirmations = chain.isLocal ? 1 : 2;
  const wait = async (hash: `0x${string}`) => publicClient.waitForTransactionReceipt({ hash, confirmations });
  const startBlock = Number(await publicClient.getBlockNumber());

  console.log("\n--- deploying ---");
  const tokenDeployer = await viem.deployContract("TokenDeployer");
  const poolDeployer = await viem.deployContract("PoolDeployer");
  const saleDeployer = await viem.deployContract("SaleDeployer");
  const treasuryDeployer = await viem.deployContract("TreasuryDeployer");
  const mintTokenDeployer = await viem.deployContract("MintTokenDeployer");
  const taxPoolDeployer = await viem.deployContract("TaxPoolDeployer");
  const emissionDeployer = await viem.deployContract("EmissionDeployer");
  const libraries = {
    TokenDeployer: tokenDeployer.address,
    PoolDeployer: poolDeployer.address,
    SaleDeployer: saleDeployer.address,
    TreasuryDeployer: treasuryDeployer.address,
    MintTokenDeployer: mintTokenDeployer.address,
    TaxPoolDeployer: taxPoolDeployer.address,
    EmissionDeployer: emissionDeployer.address,
  };
  for (const [name, address] of Object.entries(libraries)) console.log(`${name.padEnd(17)} ${address}`);

  const factory = await viem.deployContract("PortusFactory", [quoteAdmin, ecosystem, rootPublisher], { libraries });
  const locker = await factory.read.locker();
  const feeSplitter = await factory.read.feeSplitter();
  const distributor = await factory.read.distributor();
  const flywheel = await factory.read.flywheel();
  console.log(`PortusFactory   ${factory.address}`);
  console.log(`PortusLocker    ${locker}`);
  console.log(`FeeSplitter     ${feeSplitter}`);
  console.log(`Distributor     ${distributor}`);
  console.log(`Flywheel        ${flywheel}`);

  const quoteAssets: DeploymentQuoteAsset[] = [];
  if (chain.isLocal) {
    // Test assets, local only. A public deployment registers real assets from
    // the quoteAdmin multisig after checking their addresses (N9).
    const weth = await viem.deployContract("MockWETH");
    const usd = await viem.deployContract("MockERC20", ["Mock USD", "mUSD", 6]);
    // Flywheel eligibility threshold: 1 WETH / 1,000 mUSD of pool quote reserve.
    await wait(await factory.write.setQuoteAsset([weth.address, true, false, 1n, maxUint128, zeroAddress, parseEther("1")]));
    await wait(await factory.write.setQuoteAsset([usd.address, true, true, 1n, maxUint128, zeroAddress, 1_000_000_000n]));
    quoteAssets.push(
      { address: weth.address, symbol: "WETH", decimals: 18, freezable: false },
      { address: usd.address, symbol: "mUSD", decimals: 6, freezable: true },
    );
    console.log(`MockWETH        ${weth.address}`);
    console.log(`MockUSD (6dp)   ${usd.address}`);
  } else if (!chain.requiresAudit && process.env.PORTUS_TEST_WETH === "yes") {
    // Testnet only: a freely mintable "tWETH" so testers need no bridge. Requires
    // the deployer to be quoteAdmin, since it registers the asset itself.
    if (quoteAdmin.toLowerCase() !== deployerAddress.toLowerCase()) {
      throw new Error("PORTUS_TEST_WETH=yes needs PORTUS_QUOTE_ADMIN to be the deployer.");
    }
    const tweth = await viem.deployContract("TestWETH");
    await wait(await factory.write.setQuoteAsset([tweth.address, true, false, 1n, maxUint128, zeroAddress, parseEther("1")]));
    quoteAssets.push({ address: tweth.address, symbol: "tWETH", decimals: 18, freezable: false });
    console.log(`TestWETH        ${tweth.address}`);
  }

  const deployment: DeploymentFile & Record<string, unknown> = {
    chainId,
    network: chain.networkName,
    factory: factory.address,
    locker,
    feeSplitter,
    distributor,
    flywheel,
    quoteAdmin,
    ecosystem,
    rootPublisher,
    quoteAssets,
    libraries,
    deployer: deployerAddress,
    deployedAt: new Date().toISOString(),
    startBlock,
    gitCommit: gitCommit(),
  };

  const seedDemo = chain.isLocal ? process.env.SEED_DEMO_LAUNCH !== "false" : process.env.SEED_DEMO_LAUNCH === "true";
  if (seedDemo && quoteAssets[0]) {
    console.log("\n--- seeding a demo launch ---");
    const demo = await createDemoLaunch(viem, factory.address as Address, quoteAssets[0].address as Address, {
      saleMinutes: Number(process.env.SALE_MINUTES ?? 60),
    });
    deployment.demoToken = demo.token;
    console.log(`demo launch #${demo.launchId}  token ${demo.token}`);
    console.log(`  sale  ${demo.sale}`);
    console.log(`  pool  ${demo.pool}`);
    console.log(`  window ${new Date(Number(demo.startTime) * 1000).toISOString()} â†?${new Date(Number(demo.endTime) * 1000).toISOString()}`);
  }

  mkdirSync(resolve(ROOT, "deployments"), { recursive: true });
  const outPath = resolve(ROOT, `deployments/${chainId}.json`);
  writeFileSync(outPath, JSON.stringify(deployment, null, 2) + "\n");
  console.log(`\nwrote ${outPath}`);

  if (chain.explorerUrl) {
    console.log(`\nexplorer: ${explorerAddressUrl(chainId, factory.address)}`);
    console.log(`verify:   npx hardhat verify --network ${chain.networkName} ${factory.address} ${quoteAdmin}`);
    console.log(`\nNext: from the quoteAdmin multisig, call setQuoteAsset for each reviewed quote asset.`);
  }
  console.log(`\nsync your .env with:  npm run sync-env -- ${chainId}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
