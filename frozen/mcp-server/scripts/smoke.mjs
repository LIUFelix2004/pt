/**
 * Smoke test: drives the MCP server the way a real agent host would.
 *
 * Spawns dist/index.js over stdio, performs the MCP handshake, lists tools, and
 * calls the read-only ones. Also asserts the negative case that matters most:
 * there is no general-purpose transaction tool exposed.
 *
 * Run: node packages/mcp-server/scripts/smoke.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");

function loadEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

const env = { ...process.env, ...loadEnvFile(resolve(ROOT, ".env")) };

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(ROOT, "packages/mcp-server/dist/index.js")],
  env,
  stderr: "inherit",
});

const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(transport);
console.log("handshake OK\n");

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
console.log("tools exposed:", names.join(", "), "\n");

const expected = [
  "analyze_launch",
  "claim_allocation",
  "commit_bid",
  "list_launches",
  "my_status",
  "pending_actions",
  "register_participant",
  "reveal_bid",
];
check("exposes exactly the intended tool set", JSON.stringify(names) === JSON.stringify(expected));

// The security property: nothing here can move funds to an arbitrary destination.
const dangerous = names.filter((n) =>
  /send|transfer|sign|raw|exec|call_contract|approve|withdraw_to/i.test(n),
);
check("no general-purpose transaction tool is exposed", dangerous.length === 0, dangerous.join(","));

// No tool should accept a caller-supplied destination address.
const withAddressInput = tools.filter((t) => {
  const props = t.inputSchema?.properties ?? {};
  return Object.keys(props).some((k) => /^(to|target|address|recipient|contract)$/i.test(k));
});
check(
  "no tool accepts a caller-supplied destination",
  withAddressInput.length === 0,
  withAddressInput.map((t) => t.name).join(","),
);

console.log("\n--- my_status ---");
const status = await client.callTool({ name: "my_status", arguments: {} });
console.log(status.content[0].text);
check("my_status succeeded", !status.isError);

console.log("\n--- pending_actions ---");
const pending = await client.callTool({ name: "pending_actions", arguments: {} });
console.log(pending.content[0].text);
check("pending_actions succeeded", !pending.isError);

console.log("\n--- list_launches ---");
const list = await client.callTool({ name: "list_launches", arguments: {} });
console.log(list.content[0].text);
check("list_launches succeeded", !list.isError);

console.log("\n--- analyze_launch #0 ---");
const analysis = await client.callTool({ name: "analyze_launch", arguments: { auctionId: 0 } });
const text = analysis.content[0].text;
console.log(text);
check("analyze_launch succeeded", !analysis.isError);
check(
  "creator copy is fenced as untrusted",
  text.includes("BEGIN UNTRUSTED") && text.includes("END UNTRUSTED"),
);

await client.close();
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
