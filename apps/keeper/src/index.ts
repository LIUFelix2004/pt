import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { assertKeyIsSafeForChain, getChain, loadDeployment, portusFactoryAbi, portusSaleAbi } from "@portus/shared";
import { economyRound } from "./economy.js";

/**
 * Portus keeper — a convenience, not a dependency.
 *
 * `finalize()` and `sweepDust()` are permissionless; any user can call them.
 * This process just makes sure someone does: each round it walks every launch
 * the factory knows, finalizes sales whose window has closed, (optionally)
 * sweeps dust once every subscriber has claimed, and runs the economy duties in
 * ./economy.ts (treasury buybacks / reward funding, flywheel checkpoints and
 * rounds). It holds no privilege, so if it is down, these are merely delayed —
 * no funds are at risk.
 *
 *   npm run keeper            long-running loop (KEEPER_INTERVAL_SECONDS)
 *   npm run finalize:local    a single round, then exit
 */

const ONCE = process.argv.includes("--once") || process.env.npm_lifecycle_event === "once";
const DEPLOYMENT = loadDeployment(process.env);
const CHAIN = getChain(DEPLOYMENT.chainId);
const RPC_URL = process.env.RPC_URL ?? (CHAIN.isLocal ? "http://127.0.0.1:8545" : "");
if (!RPC_URL) throw new Error(`RPC_URL must be set for ${CHAIN.displayName}`);

const rawKeeperKey = (process.env.KEEPER_PRIVATE_KEY ?? (CHAIN.isLocal ? process.env.DEPLOYER_PRIVATE_KEY : undefined))?.trim();
// Accept keys pasted with or without the 0x prefix.
const keeperKey = rawKeeperKey && /^[0-9a-fA-F]{64}$/.test(rawKeeperKey) ? `0x${rawKeeperKey}` : rawKeeperKey;
if (!keeperKey || !/^0x[0-9a-fA-F]{64}$/.test(keeperKey)) {
  throw new Error("KEEPER_PRIVATE_KEY is required (DEPLOYER_PRIVATE_KEY is accepted as a fallback on local chains only)");
}
const account = privateKeyToAccount(keeperKey as Hex);
// Refuse before anything is signed.
assertKeyIsSafeForChain(account.address, DEPLOYMENT.chainId);

const chain = defineChain({
  id: DEPLOYMENT.chainId,
  name: CHAIN.displayName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) });

const CONFIRMATIONS = CHAIN.isLocal ? 1 : Math.max(2, Math.ceil(24 / CHAIN.blockTime));
const INTERVAL_MS = Number(process.env.KEEPER_INTERVAL_SECONDS ?? 30) * 1000;
const SWEEP_DUST = process.env.KEEPER_SWEEP_DUST !== "false";
const LOW_BALANCE = parseEther(process.env.KEEPER_LOW_BALANCE_ETH ?? "0.01");
const MAX_BACKOFF_ROUNDS = 32;

enum Phase {
  PENDING,
  OPEN,
  AWAITING_FINALIZE,
  SUCCEEDED,
  REFUNDING,
}

/** Sales with nothing left for the keeper to do; never re-read. */
const done = new Set<string>();
/** Per-sale exponential backoff after failures: rounds to skip. */
const backoff = new Map<string, { failures: number; skip: number }>();

function revertName(error: unknown): string | null {
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName ?? null;
  }
  return null;
}

/**
 * Simulate, send, and wait for confirmation before returning — the next action
 * must see this one's state (`writeContract` resolves on submission, which only
 * looks sequential on a chain that mines instantly).
 */
async function send(sale: Address, functionName: "finalize" | "sweepDust"): Promise<Hex> {
  const { request } = await publicClient.simulateContract({ account, address: sale, abi: portusSaleAbi, functionName });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: CONFIRMATIONS });
  if (receipt.status !== "success") throw new Error(`${functionName} ${hash} reverted`);
  return hash;
}

async function handle(sale: Address): Promise<void> {
  const read = <T>(functionName: string) =>
    publicClient.readContract({ address: sale, abi: portusSaleAbi, functionName: functionName as never }) as Promise<T>;
  const phase = Number(await read<number>("phase")) as Phase;

  if (phase === Phase.AWAITING_FINALIZE) {
    try {
      const hash = await send(sale, "finalize");
      console.log(`[keeper] finalized ${sale}  ${hash}`);
    } catch (error) {
      // Someone else got there first: that is the desired outcome.
      if (revertName(error) === "NotAwaitingFinalize") return;
      throw error;
    }
    return;
  }

  if (phase === Phase.REFUNDING) {
    done.add(sale);
    return;
  }

  if (phase === Phase.SUCCEEDED) {
    const [swept, subs, claimed] = await Promise.all([
      read<boolean>("dustSwept"),
      read<bigint>("subscriberCount"),
      read<bigint>("claimedCount"),
    ]);
    if (swept || !SWEEP_DUST) {
      done.add(sale);
      return;
    }
    if (subs === claimed) {
      try {
        const hash = await send(sale, "sweepDust");
        console.log(`[keeper] swept dust ${sale}  ${hash}`);
      } catch (error) {
        if (revertName(error) !== "AlreadySwept") throw error;
      }
      done.add(sale);
    }
  }
}

async function round(): Promise<void> {
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance < LOW_BALANCE) {
    console.warn(`[keeper] low balance: ${formatEther(balance)} ETH on ${account.address}`);
  }

  const count = await publicClient.readContract({
    address: DEPLOYMENT.factory,
    abi: portusFactoryAbi,
    functionName: "launchCount",
  });

  // Sequential on purpose: one confirmed transaction before the next.
  for (let id = 0n; id < count; id++) {
    const launch = await publicClient.readContract({
      address: DEPLOYMENT.factory,
      abi: portusFactoryAbi,
      functionName: "launchAt",
      args: [id],
    });
    const sale = launch.sale.toLowerCase() as Address;
    if (done.has(sale)) continue;

    const b = backoff.get(sale);
    if (b && b.skip > 0) {
      b.skip--;
      continue;
    }
    try {
      await handle(sale);
      backoff.delete(sale);
    } catch (error) {
      const failures = (b?.failures ?? 0) + 1;
      backoff.set(sale, { failures, skip: Math.min(2 ** failures, MAX_BACKOFF_ROUNDS) });
      console.error(`[keeper] ${sale} failed (attempt ${failures}):`, error instanceof Error ? error.message : error);
    }
  }

  const economy = process.env.KEEPER_ECONOMY !== "false";
  if (economy) {
    await economyRound({
      client: publicClient as never,
      wallet: walletClient as never,
      factory: DEPLOYMENT.factory,
      confirmations: CONFIRMATIONS,
      log: (m) => console.log(`[keeper] ${m}`),
    }).catch((error) => console.error("[keeper] economy round failed:", error instanceof Error ? error.message : error));
  }
}

console.log(`[keeper] ${CHAIN.displayName} (chain ${DEPLOYMENT.chainId})  factory ${DEPLOYMENT.factory}  as ${account.address}`);
if (ONCE) {
  await round();
} else {
  for (;;) {
    await round().catch((error) => console.error("[keeper] round failed:", error));
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}
