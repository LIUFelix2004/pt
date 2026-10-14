/**
 * Direct chain reads, used when no public API is configured (NEXT_PUBLIC_API_URL empty),
 * e.g. the static Cloudflare Pages build. Read-only: no keys, no transactions.
 * Creator copy, whitelists, swaps, candles, rewards and the flywheel still need the API.
 */
import { createPublicClient, http, parseAbiItem, erc20Abi, type Address } from "viem";
import { portusFactoryAbi, portusSaleAbi, portusPoolAbi, SALE_PHASES } from "@portus/shared/browser";
import { ACTIVE_CHAIN, FACTORY, RPC_URL } from "./chain";
import type { Launch, QuoteAsset, SubscriptionView } from "./api";

const client = createPublicClient({ chain: ACTIVE_CHAIN, transport: http(RPC_URL) });
const START_BLOCK = BigInt(process.env.NEXT_PUBLIC_START_BLOCK || "0");
const QUOTE_ASSETS = (process.env.NEXT_PUBLIC_QUOTE_ASSETS || "").split(",").map((s) => s.trim()).filter(Boolean) as Address[];
const OUTCOMES = ["NONE", "FILLED", "SHRUNK", "REFUNDED"] as const;
const rulesEvent = parseAbiItem(
  "event LaunchRules(uint256 indexed launchId, uint16 feeBps, uint16 creatorShareBps, uint16 incentiveBps, uint64 startTime, uint64 endTime, uint64 publicOpenAt, uint256 publicCap, bytes32 merkleRoot, uint8 underRule, uint16 minFillBps, uint8 treasuryMode, bytes32 metadataHash)",
);
/* eslint-disable @typescript-eslint/no-explicit-any */
const f = { address: FACTORY, abi: portusFactoryAbi as any } as const;

async function quoteInfo(asset: Address) {
  const [cfg, symbol] = await Promise.all([
    client.readContract({ ...f, functionName: "quoteAssets", args: [asset] }) as Promise<any[]>,
    client.readContract({ address: asset, abi: erc20Abi, functionName: "symbol" }).catch(() => null),
  ]);
  return { address: asset, symbol, allowed: cfg[1], freezable: cfg[2], decimals: Number(cfg[3]), minFdv: String(cfg[4]), maxFdv: String(cfg[5]) };
}

export async function chainQuoteAssets(): Promise<QuoteAsset[]> {
  return Promise.all(QUOTE_ASSETS.map(quoteInfo));
}

export async function chainLaunch(token: string): Promise<Launch | null> {
  const idPlusOne = (await client.readContract({ ...f, functionName: "launchIdOf", args: [token] })) as bigint;
  if (idPlusOne === 0n) return null;
  const launchId = idPlusOne - 1n;
  const l = (await client.readContract({ ...f, functionName: "launchAt", args: [launchId] })) as any;
  const sale = { address: l.sale as Address, abi: portusSaleAbi as any };
  const names = ["raiseTarget", "qSale", "qLp", "qInc", "priceNum", "priceDen", "phase", "totalCommitted", "subscriberCount", "claimedCount", "outcome", "poolQuote", "poolTokens", "tokensBurned", "quoteDust", "incentiveFunded"] as const;
  const [vals, logs, name, symbol, quote, reserves] = await Promise.all([
    Promise.all(names.map((n) => client.readContract({ ...sale, functionName: n }) as Promise<any>)),
    client.getLogs({ address: FACTORY, event: rulesEvent, args: { launchId }, fromBlock: START_BLOCK, toBlock: "latest" }),
    client.readContract({ address: l.token, abi: erc20Abi, functionName: "name" }),
    client.readContract({ address: l.token, abi: erc20Abi, functionName: "symbol" }),
    quoteInfo(l.quoteAsset),
    (client.readContract({ address: l.pool, abi: portusPoolAbi as any, functionName: "getReserves" }) as Promise<any[]>).catch(() => null),
  ]);
  const isMint = (await client.readContract({ ...f, functionName: "isMintPool", args: [l.pool] }).catch(() => false)) as boolean;
  const v = Object.fromEntries(names.map((n, i) => [n, vals[i]])) as Record<(typeof names)[number], any>;
  const r = logs[0]?.args;
  if (!r) return null;
  const settled = Number(v.outcome) !== 0;
  const live = reserves && reserves[0] > 0n;
  return {
    launchId: Number(launchId), creator: l.creator, token: l.token, sale: l.sale, pool: l.pool, quoteAsset: l.quoteAsset,
    raiseTarget: String(v.raiseTarget), qSale: String(v.qSale), qLp: String(v.qLp), qInc: String(v.qInc),
    priceNum: String(v.priceNum), priceDen: String(v.priceDen),
    feeBps: Number(r.feeBps), creatorShareBps: Number(r.creatorShareBps), incentiveBps: Number(r.incentiveBps),
    startTime: Number(r.startTime), endTime: Number(r.endTime), publicOpenAt: Number(r.publicOpenAt), publicCap: String(r.publicCap),
    merkleRoot: r.merkleRoot!, underRule: r.underRule === 1 ? "SHRINK" : "REFUND", minFillBps: Number(r.minFillBps),
    treasuryMode: Number(r.treasuryMode), metadataHash: r.metadataHash!,
    phase: SALE_PHASES[Number(v.phase)]!, totalCommitted: String(v.totalCommitted), subscriberCount: Number(v.subscriberCount),
    claimedCount: Number(v.claimedCount), outcome: OUTCOMES[Number(v.outcome)]!,
    poolQuote: settled ? String(v.poolQuote) : null, poolTokens: settled ? String(v.poolTokens) : null,
    tokensBurned: settled ? String(v.tokensBurned) : null, quoteDust: settled ? String(v.quoteDust) : null,
    incentiveFunded: settled ? String(v.incentiveFunded) : null,
    reserveQuote: live ? String(reserves![0]) : null, reserveToken: live ? String(reserves![1]) : null,
    indexedAtBlock: 0,
    kind: isMint ? "MINT" : "STANDARD",
    mint: null, // emission schedule and tax details are served by the API
    quote: { symbol: quote.symbol, decimals: quote.decimals, freezable: quote.freezable },
    copy: { name, symbol, description: "", docsUrl: null, imageUrl: null },
  } as Launch;
}

export async function chainLaunches(): Promise<Launch[]> {
  const n = Number(await client.readContract({ ...f, functionName: "launchCount" }));
  const all = await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const l = (await client.readContract({ ...f, functionName: "launchAt", args: [BigInt(i)] })) as any;
      return chainLaunch(l.token);
    }),
  );
  return all.filter((x): x is Launch => !!x).reverse();
}

export async function chainSubscription(saleAddr: string, account: string): Promise<SubscriptionView> {
  const sale = { address: saleAddr as Address, abi: portusSaleAbi as any };
  const rd = (fn: string, args: unknown[] = [account]) => client.readContract({ ...sale, functionName: fn, args }) as Promise<any>;
  const [c, w, p, claimed, preview] = await Promise.all([rd("committed"), rd("whitelistCommitted"), rd("publicCommitted"), rd("claimed"), rd("previewClaim")]);
  return { committed: String(c), whitelistCommitted: String(w), publicCommitted: String(p), claimed, previewTokens: String(preview[0]), previewRefund: String(preview[1]), scenarios: null };
}

export async function chainOffset(): Promise<number> {
  const b = await client.getBlock();
  return Number(b.timestamp) - Math.floor(Date.now() / 1000);
}
