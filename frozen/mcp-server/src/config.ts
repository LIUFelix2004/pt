import { parseEther } from "viem";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { legacyEnv, loadDeployment, type Deployment } from "@obscura/shared";

/**
 * Fill any missing settings from the repo-root .env.
 *
 * An MCP host passes configuration through its own config file — for Claude
 * Code that is .mcp.json, which sits in the repo and gets opened, committed and
 * screen-shared. Falling back to .env means that file needs to carry no secrets
 * at all: it names the command, and the key stays in the gitignored .env next
 * to every other credential.
 *
 * Values already present in the environment always win, so a host that does
 * pass explicit configuration keeps full control.
 */
function fillFromEnvFile(): void {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const envPath = resolve(repoRoot, ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match?.[1] && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2]!.trim();
    }
  }
}

export interface Config {
  readonly deployment: Deployment;
  readonly rpcUrl: string;
  readonly apiUrl: string;
  /** Absolute ceiling on wei this process will ever attach to a transaction. */
  readonly maxSpendWei: bigint;
  /** Where bid salts live. Losing this directory loses any unrevealed bid. */
  readonly stateDir: string;
}

let cached: Config | null = null;

/**
 * A public network has no sane default endpoint, so require an explicit one
 * rather than silently pointing at localhost and reporting "auction not found".
 */
function resolveRpcUrl(configured: string | undefined, deployment: Deployment): string {
  if (configured) return configured;
  if (deployment.chain.isLocal) return "http://127.0.0.1:8545";
  throw new Error(
    `RPC_URL must be set for ${deployment.chain.displayName} (chain ${deployment.chainId}).\n` +
      `Public endpoints exist but rate-limit hard; a free Alchemy or Infura key is worth it.`,
  );
}

/**
 * Static, non-secret configuration. Key material is NOT part of Config: it lives
 * behind the Signer abstraction in signer.ts, selected by OBSCURA_SIGNER.
 */
export function loadConfig(): Config {
  if (cached) return cached;

  fillFromEnvFile();
  const env = process.env;
  // Accept the cap in ETH as well as wei. A packaged install asks the user for
  // this in a form field, and "0.05" is a number a person can sanity-check;
  // 50000000000000000 is one they will get wrong by a factor of ten.
  const maxSpendEth = env.OBSCURA_MAX_SPEND_ETH?.trim();
  const maxSpendWei = maxSpendEth
    ? parseEther(maxSpendEth)
    : BigInt(legacyEnv("OBSCURA_MAX_SPEND_WEI", "LAUNCHPAD_MAX_SPEND_WEI") ?? "1000000000000000000");
  if (maxSpendWei <= 0n) throw new Error("The spend cap must be positive");

  const deployment = loadDeployment(env);

  cached = Object.freeze({
    deployment,
    rpcUrl: resolveRpcUrl(env.RPC_URL, deployment),
    apiUrl: legacyEnv("OBSCURA_API_URL", "LAUNCHPAD_API_URL") ?? "http://127.0.0.1:8787",
    maxSpendWei,
    stateDir: legacyEnv("OBSCURA_STATE_DIR", "LAUNCHPAD_STATE_DIR") ?? resolve(homedir(), ".obscura"),
  });
  return cached;
}
