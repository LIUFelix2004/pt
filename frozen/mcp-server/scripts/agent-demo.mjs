/**
 * Drives the launchpad MCP server exactly as a user's own agent would.
 *
 * Every tool call below is one the agent (OpenClaw / Codex / Claude Code) makes
 * on the user's machine. Nothing here talks to the launchpad operator except
 * read-only metadata fetches; the signing happens inside the MCP process.
 *
 * Time travel and settlement are done OUT OF BAND — an agent cannot do either.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = "D:/Lauchpad";
const RPC = "http://127.0.0.1:8545";

function loadEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  return (await res.json()).result;
}

async function chainNow() {
  const block = await rpc("eth_getBlockByNumber", ["latest", false]);
  return parseInt(block.timestamp, 16);
}

/**
 * Advance past a window boundary.
 *
 * Reads the real deadline rather than assuming a window size — the deploy
 * script's COMMIT_MINUTES/REVEAL_MINUTES are configurable, and a hardcoded
 * jump silently leaves the auction in the previous phase.
 */
async function advancePast(targetTs, label) {
  const now = await chainNow();
  const delta = targetTs - now + 30;
  if (delta > 0) {
    await rpc("evm_increaseTime", [delta]);
    await rpc("evm_mine", []);
  }
  console.log(`\n  ⏩  [链外操作] 时间前进 ${Math.max(0, Math.round(delta / 60))} 分钟 — ${label}\n`);
}

async function windows() {
  const res = await fetch(`${env.LAUNCHPAD_API_URL ?? "http://127.0.0.1:8787"}/launches/0`);
  const launch = await res.json();
  return { commitEnd: launch.commitEnd, revealEnd: launch.revealEnd };
}

const env = { ...process.env, ...loadEnvFile(resolve(ROOT, ".env")) };

const client = new Client({ name: "user-own-agent", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [resolve(ROOT, "packages/mcp-server/dist/index.js")],
    env,
    stderr: "ignore",
  }),
);

let step = 0;
async function call(name, args = {}) {
  step++;
  console.log(`\n${"─".repeat(72)}`);
  console.log(`【第 ${step} 步】agent 调用工具：${name}${Object.keys(args).length ? `  ${JSON.stringify(args)}` : ""}`);
  console.log("─".repeat(72));
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.map((c) => c.text).join("\n");
  console.log(text);
  if (res.isError) console.log("  ⚠ 该调用返回了错误");
  return text;
}

// ── 1. agent 报告自己的身份与额度 ───────────────────────────────────────────
await call("my_status");

// ── 2. 领取参赛资格（质押）────────────────────────────────────────────────
await call("register_participant");

// ── 3. 读取项目信息，注意不可信文案被围栏隔离 ──────────────────────────────
await call("analyze_launch", { auctionId: 0 });

// ── 4a. 先投一个超出硬上限的标：应当在产生签名之前就被拒绝 ────────────────
// 1000 枚 × 0.002 ETH = 2 ETH 抵押，而 LAUNCHPAD_MAX_SPEND_WEI = 1 ETH。
await call("commit_bid", {
  auctionId: 0,
  maxPriceWei: "2000000000000000",
  amount: "1000000000000000000000",
});

// ── 4b. 再投一个合规的标 ──────────────────────────────────────────────────
// 400 枚 × 0.002 ETH = 0.8 ETH 抵押，在上限之内。
await call("commit_bid", {
  auctionId: 0,
  maxPriceWei: "2000000000000000",
  amount: "400000000000000000000",
});

// ── 5. agent 自查待办 ─────────────────────────────────────────────────────
await call("pending_actions");

const w = await windows();
await advancePast(w.commitEnd, "commit 窗口关闭，进入 reveal");

// ── 6. 揭示 ───────────────────────────────────────────────────────────────
await call("pending_actions");
await call("reveal_bid", { auctionId: 0 });

await advancePast(w.revealEnd, "reveal 窗口关闭，进入 SETTLING");

// ── 结算由 keeper 完成，不是 agent 的职责 ─────────────────────────────────
console.log(`\n${"─".repeat(72)}`);
console.log("【链外】keeper 结算（settle 是无权限的，agent 不负责，也没有这个工具）");
console.log("─".repeat(72));
const deployment = JSON.parse(readFileSync(resolve(ROOT, "deployments/31337.json"), "utf8"));
// Spawn node on tsx's own entry point. Resolving "npx" hits npx.cmd on
// Windows, which spawnSync rejects with EINVAL unless shell:true.
const keeper = spawnSync(
  process.execPath,
  [resolve(ROOT, "node_modules/tsx/dist/cli.mjs"), "apps/keeper/src/index.ts"],
  {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      CHAIN_ID: "31337",
      RPC_URL: RPC,
      LAUNCHPAD_AUCTION_ADDRESS: deployment.launchpadAuction,
      KEEPER_PRIVATE_KEY: env.OBSCURA_PRIVATE_KEY ?? env.LAUNCHPAD_PRIVATE_KEY,
      KEEPER_ONE_SHOT: "true",
    },
  },
);
// Surface failures: a silent keeper looks identical to a settled auction until
// claim reverts with NotSettled several steps later.
if (keeper.error) console.log(`keeper 启动失败: ${keeper.error.message}`);
if (keeper.status !== 0) console.log(`keeper 退出码 ${keeper.status}`);
if (keeper.stderr?.trim()) console.log(`keeper stderr:\n${keeper.stderr.trim()}`);
console.log(keeper.stdout?.trim() || "(keeper 无 stdout 输出)");

// ── 7. 领取代币与退款 ─────────────────────────────────────────────────────
await call("claim_allocation", { auctionId: 0 });
await call("my_status");
await call("pending_actions");

await client.close();
console.log(`\n${"═".repeat(72)}`);
console.log("完整链路结束：注册 → 密封投标 → 揭示 → (keeper 结算) → 领取");
console.log("═".repeat(72));
