#!/usr/bin/env node
/**
 * Standalone entry point for the reveal guard.
 *
 * Kept in its own file on purpose. When the CLI bootstrap lived inside
 * daemon.ts, bundling the MCP server with esbuild inlined it — and because the
 * bundle's `import.meta.url` equals the entry point, the "am I the main module"
 * check turned true and the packaged extension started a second reveal loop
 * alongside the one the server already runs. A module with no side effects
 * cannot do that.
 *
 *   node dist/daemon-cli.js            watch continuously
 *   node dist/daemon-cli.js --once     single sweep, for cron/Task Scheduler
 */
import { revealPendingLocalCommits, watchPendingLocalCommits } from "./daemon.js";

const once = process.argv.includes("--once") || process.env.OBSCURA_DAEMON_ONCE === "true";
const intervalSeconds = Number(process.env.OBSCURA_DAEMON_INTERVAL_SECONDS ?? 30);

if (once) {
  revealPendingLocalCommits()
    .then((count) => console.error(`[obscura-daemon] complete; ${count} reveal(s)`))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
} else {
  watchPendingLocalCommits(intervalSeconds * 1000).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
