#!/usr/bin/env node
/**
 * Copy a deployment's addresses into .env.
 *
 * Usage: npm run sync-env -- <chainId>
 *
 * Rewrites only the chain-derived keys (CHAIN_ID, RPC_URL, the two contract
 * addresses, and their NEXT_PUBLIC_ mirrors) for Portus. Everything else in .env is left
 * untouched — in particular your private keys are never read or rewritten.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Public RPCs are rate-limited and only a starting point; a custom RPC_URL
// already in .env is kept. Ethereum has no default: bring your own provider.
const CHAIN_DEFAULTS = {
  31337: { name: "Hardhat (local)", rpc: "http://127.0.0.1:8545" },
  46630: { name: "Robinhood Chain Testnet", rpc: "https://rpc.testnet.chain.robinhood.com" },
  4663: { name: "Robinhood Chain", rpc: "https://rpc.mainnet.chain.robinhood.com" },
  1: { name: "Ethereum", rpc: "" },
};

const chainId = Number(process.argv[2]);
if (!Number.isInteger(chainId)) {
  console.error("usage: npm run sync-env -- <chainId>\n  e.g. npm run sync-env -- 46630");
  process.exit(1);
}

const deploymentPath = resolve(ROOT, `deployments/${chainId}.json`);
if (!existsSync(deploymentPath)) {
  console.error(
    `No deployment found at deployments/${chainId}.json\n` +
      `Deploy first, e.g.  npm run contracts:deploy:robinhood-testnet`,
  );
  process.exit(1);
}

const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
if (!deployment.factory) {
  console.error(`deployments/${chainId}.json is an Obscura-era record (no factory). Redeploy Portus first.`);
  process.exit(1);
}
const envPath = resolve(ROOT, ".env");

if (!existsSync(envPath)) {
  const example = resolve(ROOT, ".env.example");
  if (!existsSync(example)) {
    console.error("No .env and no .env.example to start from.");
    process.exit(1);
  }
  writeFileSync(envPath, readFileSync(example, "utf8"));
  console.log("created .env from .env.example");
}

// Existing RPC_URL wins when it is already set to something non-default:
// people paste in their own Alchemy/Infura endpoint and should not lose it.
const current = readFileSync(envPath, "utf8");
const currentRpc = current.match(/^RPC_URL=(.*)$/m)?.[1]?.trim();
const defaultRpcs = Object.values(CHAIN_DEFAULTS).map((c) => c.rpc);
const keepRpc = currentRpc && !defaultRpcs.includes(currentRpc) && currentRpc !== "";
const rpc = keepRpc ? currentRpc : (CHAIN_DEFAULTS[chainId]?.rpc ?? "");

const updates = {
  CHAIN_ID: String(chainId),
  RPC_URL: rpc,
  PORTUS_FACTORY_ADDRESS: deployment.factory,
  PORTUS_LOCKER_ADDRESS: deployment.locker,
  PORTUS_FEE_SPLITTER_ADDRESS: deployment.feeSplitter,
  PORTUS_DISTRIBUTOR_ADDRESS: deployment.distributor,
  PORTUS_FLYWHEEL_ADDRESS: deployment.flywheel,
  NEXT_PUBLIC_CHAIN_ID: String(chainId),
  NEXT_PUBLIC_RPC_URL: rpc,
  NEXT_PUBLIC_PORTUS_FACTORY_ADDRESS: deployment.factory,
};

let out = current;
for (const [key, value] of Object.entries(updates)) {
  const line = `${key}=${value}`;
  out = new RegExp(`^${key}=.*$`, "m").test(out) ? out.replace(new RegExp(`^${key}=.*$`, "m"), line) : `${out.trimEnd()}\n${line}\n`;
}
// Drop legacy key names once the new ones are written, so a later sync does not
// resurrect stale addresses from the old spelling.
for (const legacy of [
  "AGENT_REGISTRY_ADDRESS",
  "LAUNCHPAD_AUCTION_ADDRESS",
  "NEXT_PUBLIC_LAUNCHPAD_AUCTION_ADDRESS",
  "OBSCURA_REGISTRY_ADDRESS",
  "OBSCURA_AUCTION_ADDRESS",
  "NEXT_PUBLIC_OBSCURA_AUCTION_ADDRESS",
  "PORTUS_INCENTIVE_VAULT_ADDRESS",
  "PORTUS_FEE_SINK_ADDRESS",
]) {
  out = out.replace(new RegExp(`^${legacy}=.*\\r?\\n?`, "m"), "");
}
writeFileSync(envPath, out);

console.log(`synced .env to ${CHAIN_DEFAULTS[chainId]?.name ?? `chain ${chainId}`}`);
for (const [key, value] of Object.entries(updates)) console.log(`  ${key}=${value}`);
if (keepRpc) console.log("\n(kept your existing custom RPC_URL)");

if (!rpc) console.log(`\n⚠  No RPC_URL for chain ${chainId}. Set your provider's endpoint in .env.`);
