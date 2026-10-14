// CI-size invariant fuzz (plan §5.2: >= 500 launches x >= 50 steps).
// A launcher rather than inline `FUZZ_RUNS=... hardhat test` so it also runs
// under Windows' cmd, which has no inline env syntax.
import { spawnSync } from "node:child_process";

const env = {
  ...process.env,
  FUZZ_RUNS: process.env.FUZZ_RUNS ?? "500",
  FUZZ_STEPS: process.env.FUZZ_STEPS ?? "50",
};
const res = spawnSync("npx", ["hardhat", "test", "nodejs", "test/invariants.fuzz.test.ts"], {
  stdio: "inherit",
  env,
  shell: true,
});
process.exit(res.status ?? 1);
