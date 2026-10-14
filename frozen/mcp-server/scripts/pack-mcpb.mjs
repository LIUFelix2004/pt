#!/usr/bin/env node
/**
 * Build an MCP Bundle (.mcpb) for one-click install in Claude Desktop.
 *
 *   npm run pack:mcpb -w @obscura/mcp            # defaults to CHAIN_ID from .env
 *   CHAIN_ID=11155111 npm run pack:mcpb -w @obscura/mcp
 *
 * Why this exists: editing claude_desktop_config.json by hand is not a product.
 * A .mcpb is a zip that Claude Desktop installs on double-click, and the
 * `user_config` block below becomes a real settings form — the private key
 * field is masked and stored by the OS, not left in a text file.
 *
 * Contract addresses are baked in at pack time from deployments/<chainId>.json.
 * Users should never be asked to type an address: a typo there sends collateral
 * to a contract nobody is watching, and it is the operator who knows the answer.
 *
 * Claude Desktop ships its own Node runtime, so the installed extension needs
 * nothing preinstalled on the user's machine.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipStore } from "./zip-store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const ROOT = resolve(PKG, "../..");
const OUT = resolve(PKG, "dist");
const STAGE = resolve(OUT, "mcpb");

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
const chainId = Number(process.env.CHAIN_ID ?? env.CHAIN_ID ?? 11155111);

const deploymentPath = resolve(ROOT, `deployments/${chainId}.json`);
if (!existsSync(deploymentPath)) {
  console.error(
    `No deployments/${chainId}.json. Deploy first — the bundle bakes in the\n` +
      `contract addresses so users never have to type them.`,
  );
  process.exit(1);
}
const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));

const CHAIN_LABEL = { 11155111: "Sepolia", 84532: "Base Sepolia", 8453: "Base", 31337: "local" }[chainId] ?? `chain ${chainId}`;
const DEFAULT_RPC = {
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
  84532: "https://sepolia.base.org",
  8453: "https://mainnet.base.org",
  31337: "http://127.0.0.1:8545",
}[chainId] ?? "";

// ------------------------------------------------------------------ 1. bundle

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(resolve(STAGE, "server"), { recursive: true });

const esbuild = resolve(ROOT, "node_modules/esbuild/bin/esbuild");
execFileSync(process.execPath, [
  esbuild,
  resolve(PKG, "src/index.ts"),
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--target=node22",
  `--outfile=${resolve(STAGE, "server/index.js")}`,
], { stdio: "inherit" });

// ---------------------------------------------------------------- 2. manifest

const manifest = {
  manifest_version: "0.3",
  name: "obscura",
  display_name: "Obscura 暗匣",
  version: JSON.parse(readFileSync(resolve(PKG, "package.json"), "utf8")).version,
  description: `Sealed-bid token launches on ${CHAIN_LABEL}. Bid from your own agent; your key never leaves this machine.`,
  long_description:
    "Obscura runs sealed-bid, uniform-price token auctions. This extension is the only supported " +
    "way to bid: it builds and signs transactions locally with a key you configure, and the " +
    "launchpad operator never sees it.\n\n" +
    "Safety properties enforced in code, not merely promised:\n" +
    "• No general-purpose transfer tool exists, and no tool accepts a destination address.\n" +
    "• Every destination is resolved from addresses fixed at install time.\n" +
    "• A hard per-transaction spend cap you set below cannot be raised from inside a conversation.\n" +
    "• Sealed bids are auto-revealed while Claude Desktop is open, because an unrevealed bid " +
    "forfeits its collateral.",
  author: { name: "Obscura" },
  server: {
    type: "node",
    entry_point: "server/index.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.js"],
      env: {
        // Baked in by the operator — not user-editable, and not typo-able.
        CHAIN_ID: String(chainId),
        OBSCURA_REGISTRY_ADDRESS: deployment.agentRegistry,
        OBSCURA_AUCTION_ADDRESS: deployment.launchpadAuction,
        // Collected from the install form.
        RPC_URL: "${user_config.rpc_url}",
        OBSCURA_PRIVATE_KEY: "${user_config.private_key}",
        OBSCURA_MAX_SPEND_ETH: "${user_config.max_spend_eth}",
        OBSCURA_API_URL: "${user_config.api_url}",
      },
    },
  },
  user_config: {
    private_key: {
      type: "string",
      title: "Bidding wallet private key",
      description:
        "Use a wallet dedicated to bidding, funded only with what you are willing to commit. " +
        "This key stays on your machine and is never sent to the launchpad. " +
        "It is stored by your operating system, not in a text file.",
      sensitive: true,
      required: true,
    },
    max_spend_eth: {
      type: "number",
      title: "Hard spend cap per transaction (ETH)",
      description:
        "The most any single transaction may attach. Enforced before signing; nothing said in a " +
        "conversation can raise it. Set this to a number you could lose without pain.",
      default: 0.05,
      min: 0.0001,
      required: true,
    },
    rpc_url: {
      type: "string",
      title: `${CHAIN_LABEL} RPC endpoint`,
      description:
        "Your own Alchemy or Infura endpoint is strongly recommended. Public nodes rate-limit " +
        "hard, and the failure mode is a bid that silently never lands — you find out at reveal.",
      default: DEFAULT_RPC,
      required: true,
    },
    api_url: {
      type: "string",
      title: "Launchpad metadata service (optional)",
      description:
        "Supplies project descriptions only. If it is unreachable the extension reads everything " +
        "it needs straight from the chain, so bidding still works.",
      default: env.OBSCURA_API_URL || "http://127.0.0.1:8787",
      required: false,
    },
  },
  compatibility: {
    claude_desktop: ">=0.10.0",
    platforms: ["darwin", "win32"],
    runtimes: { node: ">=20.0.0" },
  },
  tools: [
    { name: "my_status", description: "Show the bidding wallet, registration, quota and spend cap" },
    { name: "list_launches", description: "List launches and their auction phase" },
    { name: "analyze_launch", description: "On-chain facts plus the creator's (untrusted) description" },
    { name: "register_participant", description: "Post the refundable participation bond" },
    { name: "commit_bid", description: "Place a sealed bid" },
    { name: "reveal_bid", description: "Open a sealed bid during the reveal window" },
    { name: "claim_allocation", description: "Collect tokens won and the unspent collateral" },
    { name: "pending_actions", description: "Reveals and claims that are due" },
  ],
  keywords: ["ethereum", "auction", "sealed-bid", "launchpad", "web3"],
  license: "MIT",
};

writeFileSync(resolve(STAGE, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// ------------------------------------------------------------ 3. secret scan

const serverText = readFileSync(resolve(STAGE, "server/index.js"), "utf8");
const manifestText = readFileSync(resolve(STAGE, "manifest.json"), "utf8");

const SECRET_KEY = /(PRIVATE_KEY|SECRET|MNEMONIC|KEYSTORE_PASS|API_KEY)/i;
const secrets = new Set();
for (const [name, value] of Object.entries({ ...process.env, ...env })) {
  const v = (value ?? "").trim();
  if (SECRET_KEY.test(name) && v.length >= 16 && !/^\$\{/.test(v)) secrets.add(v);
}
for (const [label, text] of [["server/index.js", serverText], ["manifest.json", manifestText]]) {
  const leaked = [...secrets].filter((s) => text.toLowerCase().includes(s.toLowerCase()));
  if (leaked.length) {
    console.error(`[mcpb] FAIL: ${leaked.length} real secret value(s) present in ${label}`);
    process.exit(1);
  }
}
console.log(`[mcpb] security scan OK (${secrets.size} local secret value(s) checked)`);

// ----------------------------------------------------------------- 4. package

const MCPB = resolve(OUT, "obscura.mcpb");
writeFileSync(
  MCPB,
  zipStore([
    { name: "manifest.json", data: Buffer.from(manifestText, "utf8") },
    { name: "server/index.js", data: Buffer.from(serverText, "utf8") },
  ]),
);

const sha = createHash("sha256").update(readFileSync(MCPB)).digest("hex");
writeFileSync(resolve(OUT, "obscura.mcpb.sha256"), sha + "\n");

console.log(`\nwrote ${basename(MCPB)}`);
console.log(`  network        ${CHAIN_LABEL} (${chainId})`);
console.log(`  registry       ${deployment.agentRegistry}`);
console.log(`  auction        ${deployment.launchpadAuction}`);
console.log(`  user fills in  private key · spend cap · RPC endpoint`);
console.log(`  SHA-256        ${sha}`);
console.log(`\nInstall: double-click obscura.mcpb, or drag it onto Claude Desktop.`);
