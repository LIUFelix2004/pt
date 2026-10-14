/**
 * Radar incentive / treasury reward publisher (platform side).
 *
 *   npm run rewards -w @portus/keeper            publish every pot whose last
 *                                                 24h window is complete
 *   npm run rewards -w @portus/keeper -- --dry   compute and write data only
 *
 * For each live launch and each pot (incentive; treasury when the launch is in
 * REWARDS mode; for mint-mode launches, the day's mint split by holding rank and
 * single-level referral power) it rebuilds the epoch's inputs from chain events, computes the
 * allocation with ./calc.ts, writes the full dataset — inputs summary, every
 * entry with its components and Merkle proof — to REWARDS_DIR, then publishes
 * the root. The 24h challenge period on-chain is for anyone to recompute it.
 *
 * Signs with ROOT_PUBLISHER_PRIVATE_KEY (the factory's rootPublisher).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  assertKeyIsSafeForChain,
  blockRanges,
  buildRewardTree,
  getChain,
  loadDeployment,
  portusDistributorAbi,
  portusEmissionAbi,
  portusFactoryAbi,
  portusPoolAbi,
  portusSaleAbi,
  portusTaxPoolAbi,
  portusTreasuryAbi,
  readDeploymentFile,
} from "@portus/shared";
import { RADAR_WEIGHTS_BPS, mintDayAllocation, radarAllocation, treasuryAllocation, type BalanceEvent } from "./calc.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DAY = 86_400;
const DRY = process.argv.includes("--dry");
/** Mint mode: minimum 24h average balance to be ranked for static rewards (whole tokens). */
const MINT_MIN_HOLDING = BigInt(process.env.MINT_MIN_HOLDING_TOKENS ?? "1") * 10n ** 18n;

const DEPLOYMENT = loadDeployment(process.env);
const CHAIN = getChain(DEPLOYMENT.chainId);
const RPC_URL = process.env.RPC_URL ?? (CHAIN.isLocal ? "http://127.0.0.1:8545" : "");
if (!RPC_URL) throw new Error(`RPC_URL must be set for ${CHAIN.displayName}`);
export const REWARDS_DIR = resolve(ROOT, process.env.REWARDS_DIR ?? "data/rewards");

const chain = defineChain({
  id: DEPLOYMENT.chainId,
  name: CHAIN.displayName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
const client = createPublicClient({ chain, transport: http(RPC_URL) });

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const ZERO = "0x0000000000000000000000000000000000000000";

const blockTs = new Map<bigint, number>();
async function tsOf(block: bigint): Promise<number> {
  let t = blockTs.get(block);
  if (t === undefined) {
    t = Number((await client.getBlock({ blockNumber: block })).timestamp);
    blockTs.set(block, t);
  }
  return t;
}
const order = (block: bigint, logIndex: number) => block * 1_000_000n + BigInt(logIndex);

async function logsOf<T>(fetch: (from: bigint, to: bigint) => Promise<T[]>, fromBlock: bigint, toBlock: bigint): Promise<T[]> {
  const out: T[] = [];
  for (const { from, to } of blockRanges(fromBlock, toBlock)) out.push(...(await fetch(from, to)));
  return out;
}

interface StateFile {
  [pot: string]: number; // `${token}:${asset}` → last published window end
}
const statePath = () => resolve(REWARDS_DIR, String(DEPLOYMENT.chainId), "state.json");
const loadState = (): StateFile => (existsSync(statePath()) ? JSON.parse(readFileSync(statePath(), "utf8")) : {});
const saveState = (s: StateFile) => {
  mkdirSync(dirname(statePath()), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(s, null, 2));
};

const lc = (a: string) => a.toLowerCase();

async function main() {
  const factory = DEPLOYMENT.factory;
  const read = <T>(address: Address, abi: any, functionName: string, args: unknown[] = []) =>
    client.readContract({ address, abi, functionName, args } as never) as Promise<T>;

  const distributor = await read<Address>(factory, portusFactoryAbi, "distributor");
  const splitter = await read<Address>(factory, portusFactoryAbi, "feeSplitter");
  const flywheel = await read<Address>(factory, portusFactoryAbi, "flywheel");
  const locker = await read<Address>(factory, portusFactoryAbi, "locker");

  const latest = await client.getBlock();
  const windowEnd = Math.floor(Number(latest.timestamp) / DAY) * DAY;
  const windowStart = windowEnd - DAY;
  const startBlock = BigInt(readDeploymentFile(ROOT, DEPLOYMENT.chainId)?.startBlock ?? 0);
  const head = latest.number;

  const rawKey = process.env.ROOT_PUBLISHER_PRIVATE_KEY?.trim();
  // Accept keys pasted with or without the 0x prefix.
  const key = rawKey && /^[0-9a-fA-F]{64}$/.test(rawKey) ? `0x${rawKey}` : rawKey;
  const publisher = key && /^0x[0-9a-fA-F]{64}$/.test(key) ? privateKeyToAccount(key as Hex) : null;
  if (!DRY && !publisher) throw new Error("ROOT_PUBLISHER_PRIVATE_KEY is required (or pass --dry)");
  if (publisher) assertKeyIsSafeForChain(publisher.address, DEPLOYMENT.chainId);
  const wallet = publisher ? createWalletClient({ account: publisher, chain, transport: http(RPC_URL) }) : null;

  const referrals = await logsOf(
    (from, to) => client.getContractEvents({ address: distributor, abi: portusDistributorAbi, eventName: "ReferrerBound", fromBlock: from, toBlock: to }),
    startBlock,
    head,
  );
  const referrerOf = new Map<string, string>();
  for (const r of referrals) {
    if ((await tsOf(r.blockNumber!)) < windowEnd) referrerOf.set(lc(r.args.account!), lc(r.args.referrer!));
  }

  const state = loadState();
  const count = await read<bigint>(factory, portusFactoryAbi, "launchCount");
  console.log(`[rewards] window ${new Date(windowStart * 1000).toISOString()} → ${new Date(windowEnd * 1000).toISOString()}, ${count} launch(es)`);

  for (let id = 0n; id < count; id++) {
    const l = await read<{ token: Address; sale: Address; pool: Address; treasury: Address; quoteAsset: Address }>(
      factory,
      portusFactoryAbi,
      "launchAt",
      [id],
    );
    const outcome = Number(await read<number>(l.sale, portusSaleAbi, "outcome"));
    if (outcome === 0 || outcome === 3) continue; // not settled, or refunded

    // Inputs, rebuilt from events up to the window end.
    const transfers = await logsOf(
      (from, to) => client.getLogs({ address: l.token, event: TRANSFER, fromBlock: from, toBlock: to }),
      startBlock,
      head,
    );
    const tokenEvents: BalanceEvent[] = [];
    for (const t of transfers) {
      const ts = await tsOf(t.blockNumber!);
      if (ts >= windowEnd) continue;
      const o = order(t.blockNumber!, t.logIndex!);
      if (t.args.from !== ZERO) tokenEvents.push({ ts, order: o, account: lc(t.args.from!), delta: -t.args.value! });
      if (t.args.to !== ZERO) tokenEvents.push({ ts, order: o, account: lc(t.args.to!), delta: t.args.value! });
    }
    const poolLogs = await logsOf(
      (from, to) => client.getContractEvents({ address: l.pool, abi: portusPoolAbi, fromBlock: from, toBlock: to }),
      startBlock,
      head,
    );
    const lpEvents: BalanceEvent[] = [];
    const feesByTrader = new Map<string, bigint>();
    for (const p of poolLogs as any[]) {
      const ts = await tsOf(p.blockNumber);
      if (ts >= windowEnd) continue;
      const o = order(p.blockNumber, p.logIndex);
      if (p.eventName === "LiquidityAdded") lpEvents.push({ ts, order: o, account: lc(p.args.to), delta: p.args.shares as bigint });
      if (p.eventName === "LiquidityRemoved") lpEvents.push({ ts, order: o, account: lc(p.args.provider), delta: 0n - (p.args.shares as bigint) });
      if (p.eventName === "Swap" && ts >= windowStart) {
        const who = lc(p.args.sender);
        feesByTrader.set(who, (feesByTrader.get(who) ?? 0n) + p.args.feeQuote);
      }
    }
    const [reserveQuote, reserveToken] = await read<readonly [bigint, bigint, number]>(l.pool, portusPoolAbi, "getReserves");

    // Never eligible for holding rewards: protocol contracts and any contract address.
    const excluded = new Set([l.pool, l.sale, l.treasury, distributor, splitter, flywheel, locker].map(lc));
    const holders = new Set(tokenEvents.map((e) => e.account));
    for (const h of holders) {
      if (excluded.has(h)) continue;
      const code = await client.getCode({ address: h as Address });
      if (code && code !== "0x") excluded.add(h);
    }

    // Mint-mode launches: the "treasury" slot is the Emission, and the token pot
    // holds the daily mint instead of an incentive allocation.
    const emission = await read<Address>(factory, portusFactoryAbi, "emissionOf", [l.token]);
    const isMint = lc(emission) !== ZERO;
    let staticBps = 0n;
    if (isMint) {
      staticBps = BigInt(await read<number>(emission, portusEmissionAbi, "staticBps"));
      // Tax recipients are project wallets, never ranked.
      for (const fn of ["community", "foundation", "tech", "market"]) {
        excluded.add(lc(await read<Address>(l.pool, portusTaxPoolAbi, fn)));
      }
      excluded.delete(ZERO);
    }

    const pots: Array<{ asset: Address; kind: "incentive" | "treasury" | "mint" }> = [
      { asset: l.token, kind: isMint ? "mint" : "incentive" },
    ];
    if (!isMint && Number(await read<number>(l.treasury, portusTreasuryAbi, "mode")) === 1) {
      pots.push({ asset: l.quoteAsset, kind: "treasury" });
    }

    for (const pot of pots) {
      const potKey = `${lc(l.token)}:${lc(pot.asset)}`;
      if ((state[potKey] ?? 0) >= windowEnd) continue;
      const budget = await read<bigint>(distributor, portusDistributorAbi, "available", [l.token, pot.asset]);
      if (budget === 0n) continue;

      let byAccount: Map<string, bigint>;
      let components: Record<string, Map<string, bigint>> | null = null;
      if (pot.kind === "mint") {
        const a = mintDayAllocation({
          amount: budget,
          staticBps,
          tokenEvents,
          referrerOf,
          excluded,
          minHolding: MINT_MIN_HOLDING,
          from: windowStart,
          to: windowEnd,
        });
        byAccount = a.byAccount;
        components = a.components;
      } else if (pot.kind === "incentive") {
        const a = radarAllocation({
          budget,
          lpEvents,
          tokenEvents,
          feesByTrader,
          referrerOf,
          priceNum: BigInt(reserveQuote),
          priceDen: BigInt(reserveToken),
          excluded,
          from: windowStart,
          to: windowEnd,
        });
        byAccount = a.byAccount;
        components = a.components;
      } else {
        byAccount = treasuryAllocation(budget, tokenEvents, excluded, windowStart, windowEnd).byAccount;
      }
      if (byAccount.size === 0) {
        console.log(`[rewards] ${l.token} ${pot.kind}: nobody eligible this window`);
        continue;
      }

      const epoch = await read<bigint>(distributor, portusDistributorAbi, "epochCount", [l.token, pot.asset]);
      const tree = buildRewardTree(
        l.token,
        pot.asset,
        epoch,
        [...byAccount].map(([account, amount]) => ({ account: account as Address, amount })),
      );
      const rel = `${DEPLOYMENT.chainId}/${lc(l.token)}/${lc(pot.asset)}/${epoch}.json`;
      const file = resolve(REWARDS_DIR, rel);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        file,
        JSON.stringify(
          {
            chainId: DEPLOYMENT.chainId,
            distributor,
            token: l.token,
            asset: pot.asset,
            kind: pot.kind,
            epoch: epoch.toString(),
            window: { from: windowStart, to: windowEnd },
            budget: budget.toString(),
            total: tree.total.toString(),
            root: tree.root,
            weightsBps:
              pot.kind === "incentive"
                ? Object.fromEntries(Object.entries(RADAR_WEIGHTS_BPS).map(([k, v]) => [k, v.toString()]))
                : pot.kind === "mint"
                  ? { static: staticBps.toString(), dynamic: (10_000n - staticBps).toString() }
                  : null,
            minHolding: pot.kind === "mint" ? MINT_MIN_HOLDING.toString() : undefined,
            excluded: [...excluded],
            entries: tree.entries.map((e) => ({
              account: e.account,
              amount: e.amount.toString(),
              proof: e.proof,
              components: components
                ? Object.fromEntries(Object.entries(components).map(([k, m]) => [k, (m.get(lc(e.account)) ?? 0n).toString()]))
                : null,
            })),
          },
          null,
          2,
        ),
      );
      console.log(`[rewards] ${l.token} ${pot.kind} epoch ${epoch}: ${tree.entries.length} account(s), ${tree.total} / ${budget} → ${rel}`);

      if (!DRY && wallet) {
        const hash = await wallet.writeContract({
          address: distributor,
          abi: portusDistributorAbi,
          functionName: "publishRoot",
          args: [l.token, pot.asset, tree.root, tree.total, `portus-rewards://${rel}`],
        });
        await client.waitForTransactionReceipt({ hash, confirmations: CHAIN.isLocal ? 1 : 2 });
        state[potKey] = windowEnd;
        saveState(state);
        console.log(`[rewards]   root published ${hash}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
