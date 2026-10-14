/**
 * Permissionless economy duties the keeper performs each round. None of these
 * needs any privilege — every call here can be made by anyone, and each is
 * guarded on-chain (cooldowns, TWAP guards, caps). If the keeper is down they
 * simply happen later, when someone else calls them.
 *
 * - Treasury (BUYBACK): start the TWAP observation once; afterwards call
 *   executeBuyback whenever its cooldown allows.
 * - Treasury (REWARDS): fundRewards once per 24h.
 * - Flywheel: one checkpoint per pool per day; per quote asset, start a round,
 *   nominate the top pools by 7-day TWAP market cap, execute after the window.
 * - Mint mode: call the Emission's mintDaily once a day, and `sync` the pool
 *   once so the sale's rounding dust joins the locked liquidity.
 */
import {
  BaseError,
  ContractFunctionRevertedError,
  maxUint256,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  portusEmissionAbi,
  portusFactoryAbi,
  portusFlywheelAbi,
  portusPoolAbi,
  portusSaleAbi,
  portusTaxPoolAbi,
  portusTreasuryAbi,
} from "@portus/shared";

/** Pool errors bubble up through Treasury and Flywheel calls; decode them too. */
const POOL_ERRORS = [...(portusPoolAbi as Abi), ...(portusTaxPoolAbi as Abi)].filter((x) => x.type === "error");

export interface Ctx {
  client: PublicClient;
  wallet: WalletClient;
  factory: Address;
  confirmations: number;
  log: (msg: string) => void;
}

function revertName(error: unknown): string | null {
  if (error instanceof BaseError) {
    const r = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? null;
  }
  return null;
}

/** Simulate, then send and wait. Returns null when it reverts with an expected (benign) error. */
async function tryWrite(ctx: Ctx, address: Address, abi: Abi, functionName: string, args: unknown[], benign: string[]): Promise<Hex | null> {
  try {
    const { request } = await ctx.client.simulateContract({
      account: ctx.wallet.account!,
      address,
      abi: [...abi, ...POOL_ERRORS],
      functionName,
      args,
    } as never);
    const hash = await ctx.wallet.writeContract(request as never);
    const receipt = await ctx.client.waitForTransactionReceipt({ hash, confirmations: ctx.confirmations });
    if (receipt.status !== "success") throw new Error(`${functionName} ${hash} reverted`);
    return hash;
  } catch (error) {
    const name = revertName(error);
    if (name && benign.some((b) => name.includes(b))) return null;
    throw error;
  }
}

interface LiveLaunch {
  pool: Address;
  treasury: Address;
  quoteAsset: Address;
}

export async function economyRound(ctx: Ctx): Promise<void> {
  const { client, factory } = ctx;
  const flywheel = (await client.readContract({ address: factory, abi: portusFactoryAbi, functionName: "flywheel" })) as Address;
  const count = (await client.readContract({ address: factory, abi: portusFactoryAbi, functionName: "launchCount" })) as bigint;

  const live: LiveLaunch[] = [];
  for (let id = 0n; id < count; id++) {
    const l = (await client.readContract({ address: factory, abi: portusFactoryAbi, functionName: "launchAt", args: [id] })) as any;
    const outcome = Number(await client.readContract({ address: l.sale, abi: portusSaleAbi, functionName: "outcome" }));
    if (outcome !== 1 && outcome !== 2) continue;
    const isMint = (await client.readContract({ address: factory, abi: portusFactoryAbi, functionName: "isMintPool", args: [l.pool] })) as boolean;
    if (isMint) {
      await mintDuties(ctx, l.pool, l.treasury, l.quoteAsset);
      continue;
    }
    live.push({ pool: l.pool, treasury: l.treasury, quoteAsset: l.quoteAsset });
  }

  for (const l of live) {
    const mode = Number(await client.readContract({ address: l.treasury, abi: portusTreasuryAbi, functionName: "mode" }));
    if (mode === 0) {
      // Starts the first observation, or refreshes one older than 4h; a recent
      // observation makes this revert harmlessly.
      if (await tryWrite(ctx, l.treasury, portusTreasuryAbi as Abi, "startObservation", [], ["AlreadyObserving", "PoolNotLive"])) {
        ctx.log(`treasury ${l.treasury}: TWAP observation (re)started`);
      } else if (
        await tryWrite(ctx, l.treasury, portusTreasuryAbi as Abi, "executeBuyback", [maxUint256, 0n], [
          "CooldownActive",
          "ObservationNotReady",
          "NothingToSpend",
          "SlippageExceeded",
          "InsufficientOutput",
        ])
      ) {
        ctx.log(`treasury ${l.treasury}: buyback executed`);
      }
    } else if (await tryWrite(ctx, l.treasury, portusTreasuryAbi as Abi, "fundRewards", [], ["CooldownActive", "NothingToSpend"])) {
      ctx.log(`treasury ${l.treasury}: rewards funded to the Distributor`);
    }

    if (await tryWrite(ctx, flywheel, portusFlywheelAbi as Abi, "checkpoint", [l.pool], ["CheckpointTooSoon"])) {
      ctx.log(`flywheel: checkpoint ${l.pool}`);
    }
  }

  // Flywheel rounds, one per quote asset.
  const now = Number((await client.getBlock()).timestamp);
  const assets = [...new Set(live.map((l) => l.quoteAsset.toLowerCase()))] as Address[];
  for (const q of assets) {
    const [, start, active] = (await client.readContract({
      address: flywheel,
      abi: portusFlywheelAbi,
      functionName: "roundOf",
      args: [q],
    } as never)) as readonly [bigint, bigint, boolean, number];
    if (active && now >= Number(start) + 12 * 3600) {
      if (await tryWrite(ctx, flywheel, portusFlywheelAbi as Abi, "executeRound", [q], ["NominationOpen", "NoActiveRound"])) {
        ctx.log(`flywheel ${q}: round executed`);
      }
      continue;
    }
    if (!active && (Number(start) === 0 || now >= Number(start) + 86_400)) {
      // Only start a round when something is eligible, so rounds are not wasted.
      const ranked: Array<{ pool: Address; cap: bigint }> = [];
      for (const l of live.filter((x) => x.quoteAsset.toLowerCase() === q)) {
        const [ok, cap] = (await client.readContract({
          address: flywheel,
          abi: portusFlywheelAbi,
          functionName: "twapMarketCap",
          args: [l.pool],
        })) as readonly [boolean, bigint];
        if (ok) ranked.push({ pool: l.pool, cap });
      }
      if (ranked.length === 0) continue;
      await tryWrite(ctx, flywheel, portusFlywheelAbi as Abi, "startRound", [q], ["RoundActive"]);
      ranked.sort((a, b) => (b.cap > a.cap ? 1 : b.cap < a.cap ? -1 : 0));
      for (const r of ranked.slice(0, 10)) {
        await tryWrite(ctx, flywheel, portusFlywheelAbi as Abi, "nominate", [q, r.pool], ["NotRanked", "AlreadyNominated", "NotEligible", "NominationClosed"]);
      }
      ctx.log(`flywheel ${q}: round started, ${Math.min(ranked.length, 10)} nominated`);
    }
  }
}

const ERC20_BALANCE = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

/** Mint mode: the Emission's daily mint, and a pool sync whenever stray quote (the sale's dust) is waiting. */
async function mintDuties(ctx: Ctx, pool: Address, emission: Address, quoteAsset: Address): Promise<void> {
  if (await tryWrite(ctx, emission, portusEmissionAbi as Abi, "mintDaily", [], ["NothingToMint", "NotActive"])) {
    ctx.log(`emission ${emission}: daily mint sent to the Distributor`);
  }
  const [reserveQuote] = (await ctx.client.readContract({ address: pool, abi: portusTaxPoolAbi, functionName: "getReserves" })) as readonly [bigint, bigint, number];
  const balance = (await ctx.client.readContract({ address: quoteAsset, abi: ERC20_BALANCE, functionName: "balanceOf", args: [pool] })) as bigint;
  if (balance > reserveQuote && (await tryWrite(ctx, pool, portusTaxPoolAbi as Abi, "sync", [], ["NotInitialized"]))) {
    ctx.log(`pool ${pool}: synced ${balance - reserveQuote} stray quote into the reserves`);
  }
}
