import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Address } from "./types.js";
import { getChain, type ChainConfig } from "./chains.js";

export interface Deployment {
  chainId: number;
  chain: ChainConfig;
  factory: Address;
  locker: Address | null;
  feeSplitter: Address | null;
  distributor: Address | null;
  flywheel: Address | null;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function optionalAddress(name: string, value: string | undefined): Address | null {
  if (!value) return null;
  if (!ADDRESS.test(value)) throw new Error(`${name} must be a 20-byte hex address`);
  return value.toLowerCase() as Address;
}

/**
 * Contract addresses for the configured chain, read once from the environment
 * at startup and then frozen.
 *
 * Only the factory is required: every sale and pool is discovered from its
 * LaunchCreated events, and the Locker / FeeSplitter / Distributor / Flywheel
 * addresses are immutables on the factory. The optional ones are kept for display.
 *
 * `npm run contracts:deploy` writes deployments/<chainId>.json and
 * `npm run sync-env` copies the addresses into .env.
 */
export function loadDeployment(env: Record<string, string | undefined>): Deployment {
  const chainId = Number(env.CHAIN_ID ?? 31337);
  const chain = getChain(chainId);

  const factory = env.PORTUS_FACTORY_ADDRESS;
  if (!factory) {
    throw new Error(
      `No PORTUS_FACTORY_ADDRESS configured for ${chain.displayName} (chain ${chainId}).\n` +
        `Deploy with:  npm run contracts:deploy\n` +
        `Then sync:    npm run sync-env -- ${chainId}`,
    );
  }
  if (!ADDRESS.test(factory)) throw new Error("PORTUS_FACTORY_ADDRESS must be a 20-byte hex address");

  return Object.freeze({
    chainId,
    chain,
    factory: factory.toLowerCase() as Address,
    locker: optionalAddress("PORTUS_LOCKER_ADDRESS", env.PORTUS_LOCKER_ADDRESS),
    feeSplitter: optionalAddress("PORTUS_FEE_SPLITTER_ADDRESS", env.PORTUS_FEE_SPLITTER_ADDRESS),
    distributor: optionalAddress("PORTUS_DISTRIBUTOR_ADDRESS", env.PORTUS_DISTRIBUTOR_ADDRESS),
    flywheel: optionalAddress("PORTUS_FLYWHEEL_ADDRESS", env.PORTUS_FLYWHEEL_ADDRESS),
  });
}

export interface DeploymentQuoteAsset {
  address: string;
  symbol: string;
  decimals: number;
  freezable: boolean;
}

/** Schema of deployments/<chainId>.json. */
export interface DeploymentFile {
  chainId: number;
  network: string;
  factory: string;
  locker: string;
  feeSplitter: string;
  distributor: string;
  flywheel: string;
  quoteAdmin: string;
  ecosystem: string;
  rootPublisher: string;
  quoteAssets: DeploymentQuoteAsset[];
  libraries?: Record<string, string>;
  deployer: string;
  deployedAt?: string;
  startBlock?: number;
  gitCommit?: string | null;
}

export function readDeploymentFile(repoRoot: string, chainId: number): DeploymentFile | null {
  const path = resolve(repoRoot, `deployments/${chainId}.json`);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<DeploymentFile>;
    // Obscura-era files have no factory; treat them as "nothing recorded".
    return typeof parsed.factory === "string" ? (parsed as DeploymentFile) : null;
  } catch {
    return null;
  }
}

/**
 * Warn when a running process is pointed at a different factory than the one
 * last deployed for its chain.
 *
 * Long-lived processes read addresses once at startup. A redeploy rewrites
 * deployments/<chainId>.json and .env but cannot reach a running process, which
 * then keeps serving a factory nobody uses. Nothing errors, so detect it.
 *
 * Returns null when the two agree or when no deployment has been recorded.
 */
export function deploymentMismatchWarning(
  configured: Pick<Deployment, "chainId" | "factory">,
  repoRoot: string,
): string | null {
  const file = readDeploymentFile(repoRoot, configured.chainId);
  if (!file) return null;

  const recorded = file.factory.toLowerCase();
  const inUse = configured.factory.toLowerCase();
  if (recorded === inUse) return null;

  return [
    `WARNING: this process is using a different factory than the one`,
    `last deployed to chain ${configured.chainId}.`,
    `  in use:        ${inUse}`,
    `  last deployed: ${recorded}${file.deployedAt ? `  (${file.deployedAt})` : ""}`,
    `Addresses are read from the environment at startup, so a redeploy does not`,
    `reach a running process. Restart it, after \`npm run sync-env -- ${configured.chainId}\`.`,
  ].join("\n");
}
