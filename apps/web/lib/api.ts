import type { Candle, Launch as SharedLaunch, SalePhase, SwapRecord } from "@portus/shared/browser";
import { roundTripCost } from "@portus/shared/browser";

export type { SalePhase, SwapRecord, Candle };
export { roundTripCost };

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8787";
export const NO_API = API_URL === "";

export interface Economics {
  treasury: string | null;
  creatorRecipient: string | null;
  treasuryMode: "BUYBACK" | "REWARDS";
  releaseMode: "LINEAR" | "DECAYING";
  releaseRateBps: number;
  incentiveStart: number;
  feesSplit: { ecosystem: string; flywheel: string; creator: string; treasury: string };
  buyback: { quoteSpent: string; tokensBurned: string };
  flywheel: { quoteSpent: string; tokensBurned: string };
  rewardsFunded: string;
  epochs: Array<{ asset: string; epoch: number; root: string; total: string; claimed: string; claimable_at: number; data_uri: string }>;
  live: {
    sharesBps: { ecosystem: number; flywheel: number; creator: number; treasury: number };
    treasuryBalance: string;
    treasuryLastAction: number;
    treasuryObservationStarted: boolean;
    incentiveReleased: string;
    incentiveAvailable: string;
    rewardsAvailable: string;
    lockedShares: string;
    totalShares: string;
  } | null;
}

export interface MintInfo {
  emission: string;
  initialSupply: string;
  maxSupply: string;
  staticBps: number;
  schedule: { months: number[]; growthBps: number[] };
  tax?: {
    buyBurnBps: number;
    buyCommunityBps: number;
    buyFoundationBps: number;
    sellBurnBps: number;
    sellCommunityBps: number;
    sellTechBps: number;
    dumpThresholdBps: number;
    dumpBurnShareBps: number;
    community: string;
    foundation: string;
    tech: string;
    market: string;
  };
  mintedTotal: string;
  taxBurned: string;
  taxPaid: string;
  live: {
    active: boolean;
    day: number;
    totalMinted: string;
    totalSupply: string;
    burned: string;
    mintable: string;
    nextDayMint: string;
    potAvailable: string;
  } | null;
}

export type Launch = SharedLaunch & {
  mint?: MintInfo | null;
  whitelistUploaded?: number;
  feesQuote?: string;
  dustSwept?: boolean;
  economics?: Economics;
};

export interface RewardEntry {
  asset: `0x${string}`;
  kind: "incentive" | "treasury" | "mint";
  epoch: number;
  window: { from: number; to: number };
  amount: string;
  proof: `0x${string}`[];
  components: Record<string, string> | null;
  claimableAt: number;
  claimed: boolean;
}

export const getRewards = (token: string, account: string) =>
  json<{ rewards: RewardEntry[] }>(`/launches/${token}/rewards/${account}`);
export const getOwedFees = (account: string) =>
  json<{ owed: Array<{ asset: `0x${string}`; owed: string }> }>(`/accounts/${account}/fees`);

export interface InviteeRow {
  account: `0x${string}`;
  boundAt: number;
  txHash: string;
}

export interface InviteesView {
  referrer: string | null;
  boundAt: number | null;
  invitees: InviteeRow[];
  directCount: number;
}

export interface ZoneRow {
  account: string;
  holding: string;
  isMajor: boolean;
  boundAt: number | null;
  txHash: string | null;
}

export interface ZoneView {
  token: string;
  account: string;
  mint: boolean;
  holdingBasis: string;
  note: string;
  zones: ZoneRow[];
  referralPower: string;
  directCount: number;
}

export const getInvitees = (account: string) => json<InviteesView>(`/accounts/${account}/invitees`);
export const getZones = (token: string, account: string) =>
  json<ZoneView>(`/launches/${token}/zones/${account}`);

export const getFlywheel = (asset: string) =>
  json<{
    round: number;
    start: number;
    active: boolean;
    budget: string;
    nominated: Array<{ pool: string; marketCap: string; token: string | null; name: string | null; symbol: string | null }>;
  }>(`/flywheel/${asset}`);

export interface QuoteAsset {
  address: `0x${string}`;
  symbol: string | null;
  decimals: number;
  allowed: boolean;
  freezable: boolean;
  minFdv: string;
  maxFdv: string;
}

export interface SubscriptionView {
  committed: string;
  whitelistCommitted: string;
  publicCommitted: string;
  claimed: boolean;
  previewTokens: string;
  previewRefund: string;
  scenarios: Record<"FILLED" | "SHRUNK" | "REFUNDED", { tokens: string; refund: string }> | null;
}

async function json<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<T>;
}

export async function getLaunches(opts?: { includeHidden?: boolean }): Promise<Launch[]> {
  return (await json<{ launches: Launch[] }>(`/launches?limit=200${opts?.includeHidden ? "&includeHidden=1" : ""}`)).launches;
}

export async function getLaunch(token: string): Promise<Launch | null> {
  const res = await fetch(`${API_URL}/launches/${token}`, { cache: "no-store" });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export const getQuoteAssets = () => json<QuoteAsset[]>("/quote-assets");
export const getSubscription = (token: string, account: string, _sale?: string) =>
  json<SubscriptionView>(`/launches/${token}/subscription/${account}`);
export const getSwaps = (token: string) => json<{ swaps: SwapRecord[] }>(`/launches/${token}/swaps?limit=20`);
export const getCandles = (token: string, interval: "1m" | "5m" | "1h" | "1d") =>
  json<{ candles: Candle[] }>(`/launches/${token}/candles?interval=${interval}`);

/**
 * Seconds to add to the browser clock to get chain time. Phases are decided by
 * block.timestamp, which drifts from wall time — and on a local chain jumps
 * ahead when the demo fast-forwards.
 */
export async function getChainOffset(): Promise<number> {
  const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
  if (!res.ok) return 0;
  const { chainTime } = (await res.json()) as { chainTime: number };
  return chainTime ? chainTime - Math.floor(Date.now() / 1000) : 0;
}

export async function getWhitelistEntry(token: string, account: string) {
  const res = await fetch(`${API_URL}/launches/${token}/whitelist/${account}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json() as Promise<{ cap: string; proof: `0x${string}`[] }>;
}

// ─── formatting ──────────────────────────────────────────────────────────────

/** Base units -> decimal string, trimmed to `maxFrac` fraction digits. */
export function formatUnits(value: string | bigint, decimals: number, maxFrac = 6): string {
  const v = BigInt(value);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const unit = 10n ** BigInt(decimals);
  const whole = abs / unit;
  let frac = decimals > 0 ? (abs % unit).toString().padStart(decimals, "0").slice(0, maxFrac) : "";
  frac = frac.replace(/0+$/, "");
  const w = whole.toLocaleString("en-US");
  return `${neg ? "-" : ""}${frac ? `${w}.${frac}` : w}`;
}

/** Launch tokens always have 18 decimals. */
export const formatTokens = (base: string | bigint, maxFrac = 2) => formatUnits(base, 18, maxFrac);

export const quoteSymbol = (l: Pick<Launch, "quote">) => l.quote?.symbol ?? "QUOTE";
export const quoteDecimals = (l: Pick<Launch, "quote">) => l.quote?.decimals ?? 18;
export const formatQuote = (l: Pick<Launch, "quote">, base: string | bigint, maxFrac = 6) =>
  `${formatUnits(base, quoteDecimals(l), maxFrac)} ${quoteSymbol(l)}`;

/**
 * Price of one whole token (1e18 base units) in quote, as a display string:
 * p = priceNum / priceDen quote base units per token base unit.
 */
export function formatPricePerToken(l: Pick<Launch, "quote">, num: string | bigint, den: string | bigint): string {
  const n = BigInt(num);
  const d = BigInt(den);
  if (d === 0n) return "—";
  const decimals = quoteDecimals(l);
  // Scale up for precision: quote base units per 1e18 token units, with 12 extra digits.
  const EXTRA = 12;
  const scaled = (n * 10n ** 18n * 10n ** BigInt(EXTRA)) / d;
  return `${formatUnits(scaled, decimals + EXTRA, 10)} ${quoteSymbol(l)}`;
}

/** Committed / target, as a percentage (may exceed 100). */
export function subscriptionRatio(l: Pick<Launch, "totalCommitted" | "raiseTarget">): number {
  const target = BigInt(l.raiseTarget);
  if (target === 0n) return 0;
  return Number((BigInt(l.totalCommitted) * 1000n) / target) / 10;
}

export function when(ts: number): string {
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16) + "Z";
}

/** Bind / event time in Asia/Shanghai; 0, null or undefined -> em dash (never 1970). */
export function whenCst(ts: number | null | undefined): string {
  if (!ts || !Number.isFinite(ts) || ts <= 0) return "\u2014";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ts * 1000));
  const g = (k: string) => parts.find((x) => x.type === k)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour") === "24" ? "00" : g("hour")}:${g("minute")} CST`;
}
export function countdown(target: number, now: number): string {
  const seconds = Math.max(0, target - now);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${s}s`;
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
