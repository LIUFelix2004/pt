/**
 * Mint mode ("RADR-style" launches): defaults, price preview and the emission
 * schedule, mirrored from PortusFactory.createMintLaunch / PortusEmission.
 */
import { PRICE_GRANULARITY, reducedPrice } from "./pricing.js";

const BPS = 10_000n;
const WAD = 10n ** 18n;

export interface MintScheduleInput {
  months: number[];
  growthBps: number[];
}

export interface MintTaxBps {
  buyBurnBps: number;
  buyCommunityBps: number;
  buyFoundationBps: number;
  sellBurnBps: number;
  sellCommunityBps: number;
  sellTechBps: number;
  dumpThresholdBps: number;
  dumpBurnShareBps: number;
}

/** The published RADR figures: 10M initial (5M sold + 5M in the pool at 0.2), 1B cap. */
export const MINT_DEFAULTS = {
  raiseWhole: 1_000_000n,
  initialSupply: 10_000_000n * WAD,
  maxSupply: 1_000_000_000n * WAD,
  staticBps: 5000,
  schedule: { months: [6, 36, 36, 162], growthBps: [1000, 500, 300, 100] } as MintScheduleInput,
  tax: {
    buyBurnBps: 100,
    buyCommunityBps: 100,
    buyFoundationBps: 100,
    sellBurnBps: 100,
    sellCommunityBps: 100,
    sellTechBps: 100,
    dumpThresholdBps: 300,
    dumpBurnShareBps: 5000,
  } as MintTaxBps,
} as const;

/** Factory bounds (PortusFactory constants). */
export const MINT_LIMITS = {
  maxMonthlyGrowthBps: 2000,
  maxScheduleMonths: 600,
  maxSideTaxBps: 1000,
  minDumpThresholdBps: 100,
  maxDumpThresholdBps: 5000,
} as const;

/** Half the initial supply is sold, half paired with the raise; price R / qSale. */
export function mintPreview(raiseTarget: bigint, initialSupply: bigint) {
  const qSale = initialSupply / 2n;
  return { qSale, qLp: qSale, ...reducedPrice(raiseTarget, qSale) };
}

/**
 * Snap R down to a multiple of 1e6 base units: with whole-token supplies qSale
 * is a multiple of 1e6, so gcd(R, qSale) ≥ 1e6 and the granularity rule holds.
 */
export function alignMintRaise(raiseTarget: bigint): bigint {
  const down = (raiseTarget / PRICE_GRANULARITY) * PRICE_GRANULARITY;
  return down === 0n ? PRICE_GRANULARITY : down;
}

/** Cumulative minted supply allowed after `m` whole 30-day months (PortusEmission.targetAtMonth). */
export function mintTargetAtMonth(initialSupply: bigint, maxSupply: bigint, s: MintScheduleInput, m: number): bigint {
  let v = initialSupply;
  let left = m;
  for (let i = 0; i < 4 && left > 0; i++) {
    let n = s.months[i] ?? 0;
    if (n === 0) break;
    if (n > left) n = left;
    const g = BPS + BigInt(s.growthBps[i] ?? 0);
    for (let k = 0; k < n; k++) {
      v = (v * g) / BPS;
      if (v >= maxSupply) return maxSupply;
    }
    left -= n;
  }
  return v;
}

/** Per phase: supply at its end and whether the cap was reached; plus the month the cap is hit (or null). */
export function mintScheduleSummary(initialSupply: bigint, maxSupply: bigint, s: MintScheduleInput) {
  const phases: Array<{ months: number; growthBps: number; endSupply: bigint }> = [];
  let month = 0;
  for (let i = 0; i < 4; i++) {
    const n = s.months[i] ?? 0;
    if (n === 0) break;
    month += n;
    phases.push({ months: n, growthBps: s.growthBps[i] ?? 0, endSupply: mintTargetAtMonth(initialSupply, maxSupply, s, month) });
  }
  let capMonth: number | null = null;
  for (let m = 0; m <= month; m++) {
    if (mintTargetAtMonth(initialSupply, maxSupply, s, m) >= maxSupply) {
      capMonth = m;
      break;
    }
  }
  return { phases, totalMonths: month, capMonth };
}
