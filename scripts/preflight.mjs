#!/usr/bin/env node
/**
 * Pre-deployment readiness check.
 *
 * Run this before every testnet deployment, and again whenever you are waiting
 * on faucet funds:
 *
 *   npm run preflight
 *
 * It answers one question — can the next step actually succeed — instead of
 * letting the deploy get halfway and revert.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const path = resolve(ROOT, ".env");
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const env = loadEnv();
const chainId = Number(env.CHAIN_ID ?? 31337);
const rpcUrl = env.RPC_URL || "";

/** Deployer ships the factory and 3 libraries; the keeper sends finalize/sweep txs. */
const NEEDED = { deployer: 0.02, keeper: 0.005 };

/** First accounts of the public Hardhat/Anvil mnemonic. Never fund these off a local chain. */
const DEV_ADDRESSES = new Set([
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
  "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
]);

let problems = 0;
const fail = (msg) => {
  problems++;
  console.log(`  ✗ ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

console.log(`\nPortus preflight — chain ${chainId}\n`);

if (!rpcUrl) {
  fail("RPC_URL is not set");
  process.exit(1);
}

const client = createPublicClient({ transport: http(rpcUrl) });

console.log("network");
let live = 0;
try {
  live = await client.getChainId();
  if (live === chainId) ok(`reachable, chain id ${live} matches CHAIN_ID`);
  else fail(`RPC reports chain ${live} but CHAIN_ID says ${chainId}`);
} catch (error) {
  fail(`cannot reach ${rpcUrl} — ${error instanceof Error ? error.message : error}`);
}

console.log("\nwallets");
const wallets = [
  ["deployer", env.DEPLOYER_PRIVATE_KEY, NEEDED.deployer],
  ["keeper  ", env.KEEPER_PRIVATE_KEY, NEEDED.keeper],
];

for (const [label, key, needed] of wallets) {
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    fail(`${label}: private key missing or malformed`);
    continue;
  }
  const address = privateKeyToAccount(key).address;
  if (chainId !== 31337 && DEV_ADDRESSES.has(address.toLowerCase())) {
    fail(`${label}: ${address} is a public Hardhat dev key — generate a fresh one (npm run newkey)`);
    continue;
  }
  try {
    const wei = await client.getBalance({ address });
    const eth = Number(formatEther(wei));
    const line = `${label}: ${address}  ${eth.toFixed(4)} ETH`;
    if (eth >= needed) ok(`${line}  (needs ${needed})`);
    else fail(`${line}  — needs ${needed}, short by ${(needed - eth).toFixed(4)}`);
  } catch {
    fail(`${label}: ${address} — balance lookup failed`);
  }
}

console.log("\npolicy");
if ([1, 4663].includes(chainId) && env.PORTUS_MAINNET_AUDITED !== "yes") {
  fail(`chain ${chainId} is a mainnet: deploy only after an external audit (PORTUS_MAINNET_AUDITED=yes)`);
} else ok(`chain ${chainId} deployment policy satisfied`);
for (const role of ["PORTUS_QUOTE_ADMIN", "PORTUS_ECOSYSTEM", "PORTUS_ROOT_PUBLISHER"]) {
  if (!env[role] && chainId !== 31337) fail(`${role} (multisig) is not set`);
}

console.log("\ncontracts");
const deploymentPath = resolve(ROOT, `deployments/${chainId}.json`);
if (existsSync(deploymentPath)) {
  const d = JSON.parse(readFileSync(deploymentPath, "utf8"));
  if (!d.factory) {
    fail(`deployments/${chainId}.json predates Portus — redeploy`);
  } else if (env.PORTUS_FACTORY_ADDRESS?.toLowerCase() !== d.factory.toLowerCase()) {
    ok(`deployments/${chainId}.json → factory ${d.factory}`);
    fail(`.env factory address does not match — run: npm run sync-env -- ${chainId}`);
  } else {
    ok(".env is in sync with the recorded deployment");
  }
} else {
  console.log(`  · not deployed yet (expected before the first deploy)`);
}

console.log(
  problems === 0
    ? "\nREADY — you can deploy.\n"
    : `\n${problems} item(s) blocking. Fix these, then re-run: npm run preflight\n`,
);
process.exit(problems === 0 ? 0 : 1);
