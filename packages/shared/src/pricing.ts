/**
 * Portus settlement and pool math, mirrored rule-for-rule from the contracts.
 *
 * Front end, API, keeper and tests all import from here, and contract tests
 * cross-check these results against chain state. If a formula changes in
 * PortusSale / PortusPool / PortusFactory, it changes here in the same commit.
 *
 * Everything is bigint. Integer division truncates (floor for non-negative
 * values), matching Solidity and OpenZeppelin's Math.mulDiv.
 */

export const BPS = 10_000n;
export const TOTAL_SUPPLY = 10n ** 27n;
export const FEE_TIERS = [100, 200, 300, 400, 500] as const;
export const CREATOR_SHARE_MAX_BPS = 4_000;
export const INCENTIVE_MAX_BPS = 3_000;
export const MIN_DURATION_SECONDS = 3_600;
export const MAX_DURATION_SECONDS = 14 * 86_400;
export const MAX_START_DELAY_SECONDS = 30 * 86_400;
export const DEFAULT_DURATION_SECONDS = 48 * 3_600;
export const PRICE_GRANULARITY = 10n ** 6n;
export const MIN_RELEASE_RATE_BPS = 10;
export const MAX_RELEASE_RATE_BPS = 100;
export const DEFAULT_RELEASE_RATE_BPS = 30;
export const ECOSYSTEM_SHARE_BPS = 2_000;
export const FLYWHEEL_SHARE_BPS = 2_000;
export const MAX_RAISE_TARGET = 2n ** 112n;

/** Mirrors PortusSale's Outcome enum ordinal. */
export type SaleOutcome = "NONE" | "FILLED" | "SHRUNK" | "REFUNDED";
export const OUTCOMES: readonly SaleOutcome[] = ["NONE", "FILLED", "SHRUNK", "REFUNDED"];

/** Mirrors the UnderfillRule enum ordinal. */
export type UnderfillRule = "REFUND" | "SHRINK";
export const UNDERFILL_RULES: readonly UnderfillRule[] = ["REFUND", "SHRINK"];

export function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function ceilDiv(a: bigint, d: bigint): bigint {
  return a === 0n ? 0n : (a - 1n) / d + 1n;
}

export interface SupplySplit {
  qSale: bigint;
  qLp: bigint;
  qInc: bigint;
}

/** §3.1 — the incentive pool comes half from each side, so qSale == qLp. */
export function splitSupply(incentiveBps: number | bigint, supply: bigint = TOTAL_SUPPLY): SupplySplit {
  const x = BigInt(incentiveBps);
  const qSale = (supply * (BPS - x)) / (2n * BPS);
  return { qSale, qLp: qSale, qInc: (supply * x) / BPS };
}

export interface ReducedPrice {
  /** price numerator r = R / g */
  r: bigint;
  /** price denominator s = qSale / g */
  s: bigint;
  g: bigint;
}

/** §3.2 — p = R / qSale reduced to r / s with gcd(r, s) = 1. */
export function reducedPrice(raiseTarget: bigint, qSale: bigint): ReducedPrice {
  const g = gcd(raiseTarget, qSale);
  return { r: raiseTarget / g, s: qSale / g, g };
}

/** Same outputs as PortusFactory.previewPrice. */
export function previewPrice(raiseTarget: bigint, incentiveBps: number | bigint) {
  const split = splitSupply(incentiveBps);
  return { ...split, ...reducedPrice(raiseTarget, split.qSale) };
}

/** True when the factory's granularity rule r·1e6 <= R holds. */
export function isGranular(raiseTarget: bigint, incentiveBps: number | bigint): boolean {
  if (raiseTarget <= 0n) return false;
  const { r } = previewPrice(raiseTarget, incentiveBps);
  return r * PRICE_GRANULARITY <= raiseTarget;
}

/**
 * Snap a raise target to the nearest value the factory will accept.
 *
 * qSale = 5e22·(B − X) is always a multiple of 1e6, so any multiple of 1e6 has
 * g >= 1e6 and passes. Values that already pass are returned unchanged.
 */
export function alignRaiseTarget(raiseTarget: bigint, incentiveBps: number | bigint): bigint {
  if (isGranular(raiseTarget, incentiveBps)) return raiseTarget;
  const unit = PRICE_GRANULARITY;
  const down = (raiseTarget / unit) * unit;
  const up = down + unit;
  if (down === 0n) return up;
  return raiseTarget - down < up - raiseTarget ? down : up;
}

/** FDV = p · S = R · S / qSale = 2RB / (B − X). Display only. */
export function fdvFromRaise(raiseTarget: bigint, incentiveBps: number | bigint): bigint {
  const { qSale } = splitSupply(incentiveBps);
  return (raiseTarget * TOTAL_SUPPLY) / qSale;
}

/** Inverse of fdvFromRaise, before granularity alignment: R = F·qSale / S. */
export function raiseFromFdv(fdv: bigint, incentiveBps: number | bigint): bigint {
  const { qSale } = splitSupply(incentiveBps);
  return (fdv * qSale) / TOTAL_SUPPLY;
}

export interface SaleTerms {
  raiseTarget: bigint;
  qSale: bigint;
  qLp: bigint;
  qInc: bigint;
  priceNum: bigint;
  priceDen: bigint;
  underRule: UnderfillRule;
  minFillBps: number | bigint;
}

export interface Settlement {
  outcome: Exclude<SaleOutcome, "NONE">;
  poolQuote: bigint;
  poolTokens: bigint;
  tokensForClaims: bigint;
  quoteForRefunds: bigint;
  incentive: bigint;
  burn: bigint;
  quoteDust: bigint;
}

/** §3.3–§3.5 — identical branch order to PortusSale._settlement. */
export function settle(totalCommitted: bigint, t: SaleTerms): Settlement {
  const c = totalCommitted;
  const supply = t.qSale + t.qLp + t.qInc;
  const r = t.priceNum;
  const k = c / r;
  const zero = { poolQuote: 0n, poolTokens: 0n, tokensForClaims: 0n, quoteForRefunds: 0n, incentive: 0n, burn: 0n, quoteDust: 0n };

  if (c >= t.raiseTarget) {
    return {
      ...zero,
      outcome: "FILLED",
      poolQuote: t.raiseTarget,
      poolTokens: t.qLp,
      tokensForClaims: t.qSale,
      quoteForRefunds: c - t.raiseTarget,
      incentive: t.qInc,
    };
  }
  if (t.underRule === "SHRINK" && c * BPS >= t.raiseTarget * BigInt(t.minFillBps) && k >= 1n) {
    const poolQuote = k * r;
    const poolTokens = k * t.priceDen;
    const tokensForClaims = (c * t.priceDen) / r;
    // Portus docs: only the unused sale and LP sides burn, (1 − f)(1 − x)S;
    // the incentive pool is kept whole.
    return {
      outcome: "SHRUNK",
      poolQuote,
      poolTokens,
      tokensForClaims,
      quoteForRefunds: 0n,
      incentive: t.qInc,
      burn: t.qSale - tokensForClaims + (t.qLp - poolTokens),
      quoteDust: c - poolQuote,
    };
  }
  return { ...zero, outcome: "REFUNDED", quoteForRefunds: c, burn: supply };
}

/** Per-subscriber claim, identical to PortusSale._entitlement. */
export function allocation(
  committed: bigint,
  totalCommitted: bigint,
  outcome: SaleOutcome,
  t: Pick<SaleTerms, "raiseTarget" | "qSale" | "priceNum" | "priceDen">,
): { tokens: bigint; refund: bigint } {
  if (committed === 0n) return { tokens: 0n, refund: 0n };
  switch (outcome) {
    case "FILLED":
      return {
        tokens: (committed * t.qSale) / totalCommitted,
        refund: (committed * (totalCommitted - t.raiseTarget)) / totalCommitted,
      };
    case "SHRUNK":
      return { tokens: (committed * t.priceDen) / t.priceNum, refund: 0n };
    case "REFUNDED":
      return { tokens: 0n, refund: committed };
    default:
      return { tokens: 0n, refund: 0n };
  }
}

/** Four-way fee split (FeeSplitter): ecosystem 20%, flywheel 20%, creator c, treasury the rest. */
export function splitFee(fee: bigint, creatorShareBps: number | bigint) {
  const ecosystem = (fee * BigInt(ECOSYSTEM_SHARE_BPS)) / BPS;
  const flywheel = (fee * BigInt(FLYWHEEL_SHARE_BPS)) / BPS;
  const creator = (fee * BigInt(creatorShareBps)) / BPS;
  return { ecosystem, flywheel, creator, treasury: fee - ecosystem - flywheel - creator };
}

/** Incentive tokens released after `days` whole days (PortusDistributor.released). */
export function releasedIncentive(
  total: bigint,
  mode: "LINEAR" | "DECAYING",
  rateBps: number | bigint,
  days: number | bigint,
  supply: bigint = TOTAL_SUPPLY,
): bigint {
  const d = BigInt(days);
  if (d <= 0n) return 0n;
  const r = BigInt(rateBps);
  if (mode === "LINEAR") {
    const lin = (d * r * supply) / BPS;
    return lin < total ? lin : total;
  }
  // total − total·(1 − r)^d, with the same WAD exponentiation as the contract.
  const WAD = 10n ** 18n;
  let x = ((BPS - r) * WAD) / BPS;
  let n = d;
  let acc = WAD;
  while (n > 0n) {
    if (n & 1n) acc = (acc * x) / WAD;
    x = (x * x) / WAD;
    n >>= 1n;
  }
  return total - (total * acc) / WAD;
}

// ─── pool ────────────────────────────────────────────────────────────────────

/** Buy: fee = ceil(qIn·f/B) on input; tOut = floor(qNet·T / (Q + qNet)). */
export function quoteBuy(quoteIn: bigint, reserveQuote: bigint, reserveToken: bigint, feeBps: number | bigint) {
  const fee = ceilDiv(quoteIn * BigInt(feeBps), BPS);
  const net = quoteIn - fee;
  const tokensOut = net === 0n ? 0n : (net * reserveToken) / (reserveQuote + net);
  return { tokensOut, fee, newReserveQuote: reserveQuote + net, newReserveToken: reserveToken - tokensOut };
}

/** Sell: qGross = floor(tIn·Q / (T + tIn)); fee = ceil(qGross·f/B) on output. */
export function quoteSell(tokensIn: bigint, reserveQuote: bigint, reserveToken: bigint, feeBps: number | bigint) {
  const gross = (tokensIn * reserveQuote) / (reserveToken + tokensIn);
  const fee = ceilDiv(gross * BigInt(feeBps), BPS);
  return { quoteOut: gross - fee, fee, newReserveQuote: reserveQuote - gross, newReserveToken: reserveToken + tokensIn };
}

/** Apply a slippage tolerance (bps) to an expected output. */
export function minOut(expected: bigint, slippageBps: number | bigint): bigint {
  return (expected * (BPS - BigInt(slippageBps))) / BPS;
}

/** Approximate cost of buying then immediately selling everything: 1 − (1 − f)². */
export function roundTripCost(feeBps: number): number {
  const f = feeBps / 10_000;
  return 1 - (1 - f) ** 2;
}
