/**
 * Pure radar / TWAB reward maths. No I/O: the collector feeds it events, the
 * publisher writes what it returns. Everything here is deterministic so anyone
 * can rerun it on the published inputs and get the same root.
 *
 * Radar (docs §雷达激励), per 24h epoch, budget E = what the pot can release:
 *   LP mining          40% · pro rata to third-party LP shares × time
 *   holding (TWAB)     30% · pro rata to time-weighted average balance
 *   trade rebate       20% · 10% of the trader's own fees, in tokens at the
 *                            epoch-end price; ≤ 1% of E per address
 *   single-level invite 10% · 10% of the fees of addresses that bound you as
 *                            their direct referrer; ≤ 1% of E per address
 * A component never pays more than its budget (scaled down pro rata if the
 * capped amounts exceed it). Anything unpaid stays in the pot for later epochs.
 *
 * Treasury rewards: the funded quote amount D, pro rata to 24h TWAB.
 * Excluded from TWAB everywhere: pools, contracts, the incentive pot.
 */

export const RADAR_WEIGHTS_BPS = { lp: 4_000n, holding: 3_000n, rebate: 2_000n, referral: 1_000n } as const;
export const REBATE_OF_FEE_BPS = 1_000n;
export const REFERRAL_OF_FEE_BPS = 1_000n;
export const PER_ADDRESS_CAP_BPS = 100n;
const BPS = 10_000n;

export interface BalanceEvent {
  /** Unix seconds of the block. */
  ts: number;
  /** Order within the same timestamp (block number · 1e6 + log index). */
  order: bigint;
  account: string;
  delta: bigint;
}

/**
 * Time-weighted sum ∫ b(t) dt over [from, to) for every account, given all
 * balance changes up to `to` (earlier ones set the opening balance).
 * Returns balance·seconds; divide by (to − from) for the average.
 */
export function timeWeighted(events: readonly BalanceEvent[], from: number, to: number): Map<string, bigint> {
  if (to <= from) throw new Error("empty window");
  const sorted = [...events].sort((a, b) => a.ts - b.ts || (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  const bal = new Map<string, bigint>();
  const last = new Map<string, number>();
  const acc = new Map<string, bigint>();
  const touch = (acct: string, t: number) => {
    const b = bal.get(acct) ?? 0n;
    const since = Math.max(last.get(acct) ?? from, from);
    if (t > since && b > 0n) acc.set(acct, (acc.get(acct) ?? 0n) + b * BigInt(t - since));
    last.set(acct, Math.max(t, from));
  };
  for (const e of sorted) {
    if (e.ts >= to) break;
    const t = Math.max(e.ts, from);
    touch(e.account, t);
    bal.set(e.account, (bal.get(e.account) ?? 0n) + e.delta);
  }
  for (const acct of bal.keys()) touch(acct, to);
  for (const [k, v] of acc) if (v <= 0n) acc.delete(k);
  return acc;
}

export function proRataOf(total: bigint, weights: ReadonlyMap<string, bigint>): Map<string, bigint> {
  let sum = 0n;
  for (const w of weights.values()) sum += w;
  const out = new Map<string, bigint>();
  if (sum === 0n || total === 0n) return out;
  for (const [k, w] of weights) {
    const v = (total * w) / sum;
    if (v > 0n) out.set(k, v);
  }
  return out;
}

/** Capped per-address amounts, scaled down pro rata if they exceed `budget`. */
export function cappedWithin(wanted: ReadonlyMap<string, bigint>, cap: bigint, budget: bigint): Map<string, bigint> {
  const capped = new Map<string, bigint>();
  let sum = 0n;
  for (const [k, v] of wanted) {
    const c = v < cap ? v : cap;
    if (c > 0n) {
      capped.set(k, c);
      sum += c;
    }
  }
  if (sum <= budget) return capped;
  return proRataOf(budget, capped);
}

export interface RadarInputs {
  /** Incentive tokens this epoch may allocate. */
  budget: bigint;
  /** Third-party LP share changes (genesis/locker excluded by the collector). */
  lpEvents: readonly BalanceEvent[];
  /** Launch-token balance changes (all transfers). */
  tokenEvents: readonly BalanceEvent[];
  /** Quote fees paid per trader in the window. */
  feesByTrader: ReadonlyMap<string, bigint>;
  /** account → direct referrer, as bound on-chain. */
  referrerOf: ReadonlyMap<string, string>;
  /** Epoch-end price: quote base units per token base unit, as a fraction. */
  priceNum: bigint;
  priceDen: bigint;
  /** Lower-cased addresses never eligible for holding rewards. */
  excluded: ReadonlySet<string>;
  from: number;
  to: number;
}

export interface Allocation {
  total: bigint;
  byAccount: Map<string, bigint>;
  components: Record<"lp" | "holding" | "rebate" | "referral", Map<string, bigint>>;
}

function merge(...parts: Map<string, bigint>[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const p of parts) for (const [k, v] of p) out.set(k, (out.get(k) ?? 0n) + v);
  return out;
}

export function radarAllocation(i: RadarInputs): Allocation {
  const part = (w: bigint) => (i.budget * w) / BPS;
  const cap = (i.budget * PER_ADDRESS_CAP_BPS) / BPS;

  const lp = proRataOf(part(RADAR_WEIGHTS_BPS.lp), timeWeighted(i.lpEvents, i.from, i.to));

  const twab = timeWeighted(i.tokenEvents, i.from, i.to);
  for (const k of [...twab.keys()]) if (i.excluded.has(k)) twab.delete(k);
  const holding = proRataOf(part(RADAR_WEIGHTS_BPS.holding), twab);

  // Fees are in quote; convert to tokens at the epoch-end price: tokens = quote · den / num.
  const toTokens = (quote: bigint) => (i.priceNum === 0n ? 0n : (quote * i.priceDen) / i.priceNum);
  const rebateWanted = new Map<string, bigint>();
  for (const [trader, fee] of i.feesByTrader) {
    rebateWanted.set(trader, toTokens((fee * REBATE_OF_FEE_BPS) / BPS));
  }
  const rebate = cappedWithin(rebateWanted, cap, part(RADAR_WEIGHTS_BPS.rebate));

  const referralWanted = new Map<string, bigint>();
  for (const [trader, fee] of i.feesByTrader) {
    const ref = i.referrerOf.get(trader);
    if (!ref) continue;
    referralWanted.set(ref, (referralWanted.get(ref) ?? 0n) + toTokens((fee * REFERRAL_OF_FEE_BPS) / BPS));
  }
  const referral = cappedWithin(referralWanted, cap, part(RADAR_WEIGHTS_BPS.referral));

  const byAccount = merge(lp, holding, rebate, referral);
  let total = 0n;
  for (const v of byAccount.values()) total += v;
  return { total, byAccount, components: { lp, holding, rebate, referral } };
}

/** Treasury rewards: the whole funded amount, pro rata to 24h TWAB. */
export function treasuryAllocation(
  amount: bigint,
  tokenEvents: readonly BalanceEvent[],
  excluded: ReadonlySet<string>,
  from: number,
  to: number,
): { total: bigint; byAccount: Map<string, bigint> } {
  const twab = timeWeighted(tokenEvents, from, to);
  for (const k of [...twab.keys()]) if (excluded.has(k)) twab.delete(k);
  const byAccount = proRataOf(amount, twab);
  let total = 0n;
  for (const v of byAccount.values()) total += v;
  return { total, byAccount };
}

// ─── mint mode ───────────────────────────────────────────────────────────────

/**
 * Mint-mode daily allocation of a day's mint E:
 *
 *   static  E·staticBps   · holding rank: holders (24h TWAB ≥ minHolding,
 *                           excluded addresses removed) sorted ascending; each
 *                           weighs its competition rank (ties share a rank, the
 *                           next rank skips), so the largest holder weighs most.
 *   dynamic the rest      · referral power: for each referrer, every direct
 *                           invitee is one zone worth that invitee's 24h TWAB.
 *                           The largest zone counts its cube root; every other
 *                           zone counts h·10 up to 10,000 tokens and
 *                           10,000·10 + (h − 10,000) above. Single level only.
 *
 * Amounts are token base units (18 decimals); power is in the same units.
 */
export const MINT_ZONE_STEP = 10_000n * 10n ** 18n;
export const MINT_ZONE_MULTIPLIER = 10n;

export function competitionRankWeights(balances: ReadonlyMap<string, bigint>): Map<string, bigint> {
  const sorted = [...balances].filter(([, v]) => v > 0n).sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0] < b[0] ? -1 : 1));
  const out = new Map<string, bigint>();
  let rank = 0n;
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || sorted[i]![1] !== sorted[i - 1]![1]) rank = BigInt(i + 1);
    out.set(sorted[i]![0], rank);
  }
  return out;
}

/** floor(cbrt(n)) for n ≥ 0, by Newton's method on bigints. */
export function icbrt(n: bigint): bigint {
  if (n < 0n) throw new Error("negative");
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 3));
  for (;;) {
    const y = (2n * x + n / (x * x)) / 3n;
    if (y >= x) break;
    x = y;
  }
  while (x * x * x > n) x -= 1n;
  while ((x + 1n) ** 3n <= n) x += 1n;
  return x;
}

/** Referral power of one referrer from its direct invitees' holdings (base units). */
export function referralPower(zones: readonly bigint[]): bigint {
  const live = zones.filter((z) => z > 0n).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  if (live.length === 0) return 0n;
  // cbrt in token units, kept at 18 decimals: cbrt(h · 1e36) = cbrt(h / 1e18) · 1e18.
  let power = icbrt(live[0]! * 10n ** 36n);
  for (const h of live.slice(1)) {
    power += h > MINT_ZONE_STEP ? MINT_ZONE_STEP * MINT_ZONE_MULTIPLIER + (h - MINT_ZONE_STEP) : h * MINT_ZONE_MULTIPLIER;
  }
  return power;
}

export interface MintDayInputs {
  /** Tokens minted for this day (what the root may allocate). */
  amount: bigint;
  staticBps: bigint;
  tokenEvents: readonly BalanceEvent[];
  referrerOf: ReadonlyMap<string, string>;
  excluded: ReadonlySet<string>;
  /** Minimum 24h TWAB to rank (base units). */
  minHolding: bigint;
  from: number;
  to: number;
}

export function mintDayAllocation(i: MintDayInputs): {
  total: bigint;
  byAccount: Map<string, bigint>;
  components: { static: Map<string, bigint>; dynamic: Map<string, bigint> };
  power: Map<string, bigint>;
} {
  const span = BigInt(i.to - i.from);
  const avg = new Map<string, bigint>();
  for (const [k, v] of timeWeighted(i.tokenEvents, i.from, i.to)) {
    if (i.excluded.has(k)) continue;
    const a = v / span;
    if (a > 0n) avg.set(k, a);
  }

  const ranked = new Map([...avg].filter(([, v]) => v >= i.minHolding));
  const staticBudget = (i.amount * i.staticBps) / BPS;
  const stat = proRataOf(staticBudget, competitionRankWeights(ranked));

  const zones = new Map<string, bigint[]>();
  for (const [invitee, referrer] of i.referrerOf) {
    if (i.excluded.has(referrer)) continue;
    const h = avg.get(invitee) ?? 0n;
    if (h === 0n) continue;
    const list = zones.get(referrer) ?? [];
    list.push(h);
    zones.set(referrer, list);
  }
  const power = new Map<string, bigint>();
  for (const [referrer, list] of zones) {
    const p = referralPower(list);
    if (p > 0n) power.set(referrer, p);
  }
  const dynamic = proRataOf(i.amount - staticBudget, power);

  const byAccount = merge(stat, dynamic);
  let total = 0n;
  for (const v of byAccount.values()) total += v;
  return { total, byAccount, components: { static: stat, dynamic }, power };
}
