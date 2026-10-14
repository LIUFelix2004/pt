import { network } from "hardhat";
import {
  formatEther,
  getAddress,
  maxUint128,
  parseEther,
  type Address,
  zeroAddress,
} from "viem";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

// Canonical mainnet WETH. Override with QUOTE_ASSET=0x...
const DEFAULT_WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

async function main() {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const [wallet] = await viem.getWalletClients();
  if (!wallet) throw new Error("No signer. Set DEPLOYER_PRIVATE_KEY in .env.");

  const deploymentPath = resolve(ROOT, `deployments/${chainId}.json`);
  if (!existsSync(deploymentPath)) {
    throw new Error(`Missing deployments/${chainId}.json`);
  }
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
  const factoryAddr = getAddress(
    process.env.PORTUS_FACTORY_ADDRESS || deployment.factory,
  ) as Address;
  const asset = getAddress(process.env.QUOTE_ASSET || DEFAULT_WETH) as Address;

  const factory = await viem.getContractAt("PortusFactory", factoryAddr);
  const quoteAdmin = (await factory.read.quoteAdmin()) as Address;
  const signer = wallet.account.address;

  console.log(`chain:       ${chainId}`);
  console.log(`factory:     ${factoryAddr}`);
  console.log(`quoteAdmin:  ${quoteAdmin}`);
  console.log(`signer:      ${signer}`);
  console.log(`asset:       ${asset}`);

  if (signer.toLowerCase() !== quoteAdmin.toLowerCase()) {
    throw new Error(`Signer is not quoteAdmin. Need ${quoteAdmin}.`);
  }

  const bal = await publicClient.getBalance({ address: signer });
  console.log(`balance:     ${formatEther(bal)} ETH`);
  if (bal < parseEther("0.0003")) {
    throw new Error(`Balance too low (${formatEther(bal)} ETH). Aborting before send.`);
  }

  // Match local-deploy WETH registration:
  // allowed=true, freezable=false, minFdv=1, maxFdv=max, priceSource=0 (ETH), minPoolLiq=1e18
  const allowed = true;
  const freezable = process.env.QUOTE_FREEZABLE === "true";
  const minFdv = 1n;
  const maxFdv = maxUint128;
  const priceSource = (process.env.QUOTE_PRICE_SOURCE
    ? getAddress(process.env.QUOTE_PRICE_SOURCE)
    : zeroAddress) as Address;
  const minPoolLiquidity = parseEther(process.env.QUOTE_MIN_POOL_LIQ || "1");

  const existing = await factory.read.quoteAssets([asset]);
  console.log(`existing registered=${existing[0]} allowed=${existing[1]}`);

  console.log("sending setQuoteAsset...");
  const hash = await factory.write.setQuoteAsset([
    asset,
    allowed,
    freezable,
    minFdv,
    maxFdv,
    priceSource,
    minPoolLiquidity,
  ]);
  console.log(`tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 2,
  });
  console.log(`status: ${receipt.status}  block: ${receipt.blockNumber}  gasUsed: ${receipt.gasUsed}`);
  if (receipt.status !== "success") throw new Error("setQuoteAsset reverted");

  const cfg = await factory.read.quoteAssets([asset]);
  // registered, allowed, freezable, decimals, minFdv, maxFdv, priceSource, minPoolLiquidity
  console.log(
    `on-chain: registered=${cfg[0]} allowed=${cfg[1]} freezable=${cfg[2]} decimals=${cfg[3]} minLiq=${cfg[7]}`,
  );

  const symbol = "WETH";
  const decimals = Number(cfg[3]);
  const list: Array<{ address: string; symbol: string; decimals: number; freezable: boolean }> =
    Array.isArray(deployment.quoteAssets) ? deployment.quoteAssets : [];
  const idx = list.findIndex((q) => q.address.toLowerCase() === asset.toLowerCase());
  const entry = { address: asset, symbol, decimals, freezable };
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  deployment.quoteAssets = list;
  writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2) + "\n");
  console.log(`updated ${deploymentPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
