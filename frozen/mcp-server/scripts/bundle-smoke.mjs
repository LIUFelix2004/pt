/**
 * Bundle smoke test: builds the single-file bundle, runs it over stdio, and
 * asserts the exposed tool set matches the canonical set. A bundle that drops
 * a dependency would only fail on the user's machine — catch it here instead.
 *
 * Run: node scripts/bundle-smoke.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const ROOT = resolve(PKG, "../..");
const BUNDLE = resolve(PKG, "dist/obscura-mcp.mjs");

if (!existsSync(BUNDLE)) {
  console.error("dist/obscura-mcp.mjs missing — run `npm run bundle -w @obscura/mcp` first");
  process.exit(1);
}

const expected = ["analyze_launch", "claim_allocation", "commit_bid", "list_launches", "my_status", "pending_actions", "register_participant", "reveal_bid"].sort();

const env = { ...process.env };
// Minimal env so the server boots. Addresses are placeholders (read-only tools
// never target them); the private key is the public Hardhat dev key, safe on a
// local chain only, which is all this smoke needs.
env.CHAIN_ID ??= "31337";
env.RPC_URL ??= "http://127.0.0.1:8545";
env.OBSCURA_REGISTRY_ADDRESS ??= "0x0000000000000000000000000000000000000001";
env.OBSCURA_AUCTION_ADDRESS ??= "0x0000000000000000000000000000000000000002";
env.OBSCURA_PRIVATE_KEY ??= "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const transport = new StdioClientTransport({ command: process.execPath, args: [BUNDLE], env, stderr: "inherit" });
const client = new Client({ name: "bundle-smoke", version: "1.0.0" });
await client.connect(transport);
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
await client.close();

const ok = JSON.stringify(names) === JSON.stringify(expected);
console.log(`${ok ? "PASS" : "FAIL"}  bundled single file exposes exactly the intended tool set`);
if (!ok) {
  console.log("  expected:", expected.join(", "));
  console.log("  actual:  ", names.join(", "));
  process.exit(1);
}
