#!/usr/bin/env node
/**
 * Tear the workspace back down to source.
 *
 *   npm run reset                  build artifacts + local chain state
 *   npm run reset -- --hard        the above, plus node_modules
 *   npm run reset -- --wipe-state  the above, plus current deployment records
 *
 * What this never touches, at any flag level:
 *
 *   .env — it holds the funded keys. Deleting it does not just lose config, it
 *   loses control of whatever those addresses hold and of every contract they
 *   own. Remove it by hand if you genuinely mean to.
 *
 * Obscura-era bid salts in ~/.obscura are never deleted here. Portus has no
 * commit-reveal, but an old Sepolia auction might still hold an unrevealed bid,
 * and that salt is its only copy. --wipe-state only reports it.
 *
 * deployments/archive-obscura/ is kept: it is the read-only record of the old
 * contracts.
 */
import { existsSync, readFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const hard = args.includes("--hard") || args.includes("--wipe-state");
const wipeState = args.includes("--wipe-state");

const bytes = (n) =>
  n > 1 << 30 ? `${(n / (1 << 30)).toFixed(1)}G` : n > 1 << 20 ? `${(n / (1 << 20)).toFixed(0)}M` : `${(n / 1024).toFixed(0)}K`;

function sizeOf(path) {
  try {
    const s = statSync(path);
    if (!s.isDirectory()) return s.size;
    let total = 0;
    for (const entry of readdirSync(path)) total += sizeOf(join(path, entry));
    return total;
  } catch {
    return 0;
  }
}

function drop(relative, label) {
  const path = resolve(ROOT, relative);
  if (!existsSync(path)) return;
  const size = sizeOf(path);
  rmSync(path, { recursive: true, force: true });
  console.log(`  removed ${label ?? relative}  (${bytes(size)})`);
}

// ---------------------------------------------------------------- 1. services

console.log("\nstopping services");
for (const port of [8545, 8787, 3456]) {
  try {
    const out = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
    const line = out.split("\n").find((l) => l.includes(`:${port} `) && l.includes("LISTENING"));
    const pid = line?.trim().split(/\s+/).pop();
    if (pid && /^\d+$/.test(pid)) {
      execFileSync("taskkill", ["/PID", pid, "/F"], { stdio: "ignore" });
      console.log(`  stopped :${port} (pid ${pid})`);
    }
  } catch {
    /* not listening, or not Windows — nothing to stop */
  }
}

// ------------------------------------------------------------- 2. build output

console.log("\nremoving build output");
for (const path of [
  "apps/web/.next",
  "apps/web/tsconfig.tsbuildinfo",
  "apps/api/dist",
  "packages/shared/dist",
  "packages/shared/tsconfig.tsbuildinfo",
  "frozen/mcp-server/dist",
  "contracts/artifacts",
  "contracts/cache",
  "contracts/coverage",
  "contracts/types",
]) {
  drop(path);
}

// --------------------------------------------------------- 3. local chain data

console.log("\nremoving local run data");
drop("apps/api/data");
drop("data");
drop("contracts/.bids");
drop("deployments/whitelists");

if (hard) {
  console.log("\nremoving dependencies");
  drop("node_modules");
  drop("package-lock.json");
}

// ------------------------------------------------------------------- 4. state

if (wipeState) {
  const store = resolve(homedir(), ".obscura", "commits.json");
  if (existsSync(store)) {
    let unrevealed = 0;
    try {
      for (const record of Object.values(JSON.parse(readFileSync(store, "utf8")))) {
        if (!record.revealTxHash) unrevealed++;
      }
    } catch {
      unrevealed = -1;
    }
    console.log(
      `\nleft ${store} in place` +
        (unrevealed !== 0
          ? ` — it lists ${unrevealed < 0 ? "unreadable records" : `${unrevealed} unrevealed Obscura bid(s)`}; check the old auction before deleting it by hand.`
          : "."),
    );
  }

  console.log("\nremoving deployment records (archive-obscura kept)");
  const dir = resolve(ROOT, "deployments");
  for (const entry of existsSync(dir) ? readdirSync(dir) : []) {
    if (entry.endsWith(".json")) drop(`deployments/${entry}`);
  }
}

console.log("\n.env left in place — it holds your funded keys.\n");
console.log(
  hard
    ? "Next:  npm install  →  see docs/runbook.md\n"
    : "Next:  npm run build --workspaces --if-present  →  see docs/runbook.md\n",
);
