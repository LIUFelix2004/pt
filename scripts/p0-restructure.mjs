#!/usr/bin/env node
/**
 * One-time P0 restructure (Obscura -> Portus): MOVES ONLY, nothing is deleted.
 *
 *   node scripts/p0-restructure.mjs           dry run: print what would move
 *   node scripts/p0-restructure.mjs --apply   perform the moves
 *
 * Every Obscura-only file goes to docs/archive/obscura/removed/,
 * deployments/archive-obscura/ or frozen/, so it stays readable and can be
 * moved back. A full copy of the pre-change tree is also at
 * D:\Lauchpad-obscura-backup. Already-moved items are skipped, so re-running is safe.
 */
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const R = "docs/archive/obscura/removed";

/** [from, to] relative to the repo root. */
const MOVES = [
  // D2 — freeze the MCP server outside the workspaces
  ["packages/mcp-server", "frozen/mcp-server"],
  ["docs/install-claude-desktop.md", "frozen/mcp-server/docs/install-claude-desktop.md"],
  [".mcp.json", "frozen/mcp-server/.mcp.json.example"],

  // Obscura deployment records (read-only history)
  ["deployments/11155111.json", "deployments/archive-obscura/11155111.json"],
  ["deployments/31337.json", "deployments/archive-obscura/31337.json"],
  ["deployments/localhost.json", "deployments/archive-obscura/localhost.json"],

  // Obscura-phase documents
  ["docs/demo-sepolia.md", "docs/archive/obscura/demo-sepolia.md"],
  ["docs/mvp-runbook.md", "docs/archive/obscura/mvp-runbook.md"],
  ["docs/next-ui-tasks.md", "docs/archive/obscura/next-ui-tasks.md"],
  ["docs/rebrand-frontend-tasks.md", "docs/archive/obscura/rebrand-frontend-tasks.md"],
  ["docs/rebrand-status.md", "docs/archive/obscura/rebrand-status.md"],
  ["docs/personhood.md", "docs/archive/obscura/personhood.md"],
  ["docs/Obscura-投资人简介-A4.pdf", "docs/archive/obscura/Obscura-投资人简介-A4.pdf"],
  ["docs/Obscura-投资人简介-手机版.pdf", "docs/archive/obscura/Obscura-投资人简介-手机版.pdf"],
  ["docs/build-investor-pdf.py", "docs/archive/obscura/build-investor-pdf.py"],

  // D1 / D3 — auction, registry and personhood contracts and their tests
  ["contracts/contracts/LaunchpadAuction.sol", `${R}/contracts/LaunchpadAuction.sol`],
  ["contracts/contracts/AgentRegistry.sol", `${R}/contracts/AgentRegistry.sol`],
  ["contracts/contracts/IPersonhoodVerifier.sol", `${R}/contracts/IPersonhoodVerifier.sol`],
  ["contracts/contracts/MockPersonhoodVerifier.sol", `${R}/contracts/MockPersonhoodVerifier.sol`],
  ["contracts/test/launchpad.test.ts", `${R}/contracts-test/launchpad.test.ts.txt`],
  ["contracts/test/batch-settlement.test.ts", `${R}/contracts-test/batch-settlement.test.ts.txt`],
  ["contracts/test/settlement.fuzz.test.ts", `${R}/contracts-test/settlement.fuzz.test.ts.txt`],
  ["contracts/scripts/drive.ts", `${R}/contracts-scripts/drive.ts.txt`],
  ["contracts/scripts/new-auction.ts", `${R}/contracts-scripts/new-auction.ts.txt`],

  // API: clearing-price helper (auction only)
  ["apps/api/src/clearing.ts", `${R}/api/clearing.ts.txt`],

  // Web: MCP download, auction pages, old component directory
  ["apps/web/app/download", `${R}/web/download`],
  ["apps/web/app/launch/[id]", `${R}/web/launch-id`],
  ["apps/web/app/create/create-auction-form.tsx", `${R}/web/create-auction-form.tsx.txt`],
  ["apps/web/components/obscura", `${R}/web/components-obscura`],
];

let moved = 0;
let skipped = 0;
for (const [from, to] of MOVES) {
  const src = resolve(ROOT, from);
  const dst = resolve(ROOT, to);
  if (!existsSync(src)) {
    skipped++;
    continue;
  }
  if (existsSync(dst)) {
    console.log(`  ! target exists, left in place: ${from} -> ${to}`);
    skipped++;
    continue;
  }
  console.log(`  ${APPLY ? "moved" : "would move"}  ${from}  ->  ${to}`);
  if (APPLY) {
    mkdirSync(dirname(dst), { recursive: true });
    renameSync(src, dst);
  }
  moved++;
}

console.log(`\n${APPLY ? "moved" : "would move"} ${moved}, skipped ${skipped}.`);
if (!APPLY) console.log("Dry run. Re-run with --apply to perform the moves.");
else console.log("Next: npm install  (re-links workspaces), then npm run typecheck && npm test.");
