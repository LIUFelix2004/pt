import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  alignRaiseTarget,
  allocation,
  fdvFromRaise,
  isGranular,
  minOut,
  previewPrice,
  quoteBuy,
  quoteSell,
  raiseFromFdv,
  roundTripCost,
  settle,
  splitSupply,
  TOTAL_SUPPLY,
  type SaleTerms,
} from "./pricing.js";

const WAD = 10n ** 18n;

function terms(raiseTarget: bigint, x: number, rule: "REFUND" | "SHRINK" = "REFUND", minFillBps = 0): SaleTerms {
  const p = previewPrice(raiseTarget, x);
  return { raiseTarget, qSale: p.qSale, qLp: p.qLp, qInc: p.qInc, priceNum: p.r, priceDen: p.s, underRule: rule, minFillBps };
}

describe("pricing", () => {
  it("splits supply exactly, half of the incentive from each side", () => {
    for (const x of [0, 1, 1234, 3000, 10_000]) {
      const s = splitSupply(x);
      assert.equal(s.qSale, s.qLp);
      assert.equal(s.qSale + s.qLp + s.qInc, TOTAL_SUPPLY);
    }
    const s = splitSupply(3000);
    assert.equal(s.qSale, 35n * 10n ** 25n);
    assert.equal(s.qInc, 3n * 10n ** 26n);
  });

  it("§3.8 price: R = 10 WETH, X = 30% -> r = 1, s = 3.5e7", () => {
    const p = previewPrice(10n * WAD, 3000);
    assert.equal(p.r, 1n);
    assert.equal(p.s, 35_000_000n);
    assert.equal(p.g, 10n * WAD);
  });

  it("§3.8 oversubscribed allocations", () => {
    const t = terms(10n * WAD, 3000);
    const c = [10n * WAD, 7n * WAD + 3n, 8n * WAD - 3n];
    const C = c.reduce((a, b) => a + b);
    const s = settle(C, t);
    assert.equal(s.outcome, "FILLED");
    const got = c.map((ci) => allocation(ci, C, "FILLED", t));
    assert.deepEqual(
      got.map((g) => g.tokens),
      [140000000000000000000000000n, 98000000000000000042000000n, 111999999999999999958000000n],
    );
    assert.deepEqual(
      got.map((g) => g.refund),
      [6n * WAD, 4200000000000000001n, 4799999999999999998n],
    );
  });

  it("§3.8 shrink", () => {
    const t = terms(10n * WAD, 3000, "SHRINK");
    const C = 42n * 10n ** 17n + 7n;
    const s = settle(C, t);
    assert.equal(s.outcome, "SHRUNK");
    assert.equal(s.poolQuote, C);
    assert.equal(s.poolTokens, 147000000000000000245000000n);
    // Docs: the incentive pool is kept whole; only sale + LP leftovers burn.
    assert.equal(s.incentive, 3n * 10n ** 26n);
    assert.equal(s.burn, (35n * 10n ** 25n - s.tokensForClaims) + (35n * 10n ** 25n - s.poolTokens));
    assert.equal(s.quoteDust, 0n);
    assert.equal(s.poolTokens + s.tokensForClaims + s.incentive + s.burn, TOTAL_SUPPLY);
  });

  it("refund branches: REFUND rule, below minFill, k = 0, nobody", () => {
    assert.equal(settle(5n * WAD, terms(10n * WAD, 3000)).outcome, "REFUNDED");
    assert.equal(settle(5n * WAD - 1n, terms(10n * WAD, 3000, "SHRINK", 5000)).outcome, "REFUNDED");
    assert.equal(settle(5n * WAD, terms(10n * WAD, 3000, "SHRINK", 5000)).outcome, "SHRUNK");
    assert.equal(settle(2n, terms(3_000_000n, 3000, "SHRINK")).outcome, "REFUNDED");
    const none = settle(0n, terms(10n * WAD, 3000, "SHRINK"));
    assert.equal(none.outcome, "REFUNDED");
    assert.equal(none.burn, TOTAL_SUPPLY);
  });

  it("granularity alignment snaps to a multiple of 1e6 only when needed", () => {
    assert.equal(isGranular(10n * WAD + 1n, 3000), false);
    assert.equal(alignRaiseTarget(10n * WAD + 1n, 3000), 10n * WAD);
    assert.equal(alignRaiseTarget(10n * WAD, 3000), 10n * WAD);
    assert.equal(alignRaiseTarget(1n, 3000), 1_000_000n);
    assert.equal(isGranular(alignRaiseTarget(123_456_789n, 2500), 2500), true);
  });

  it("FDV <-> raise", () => {
    // FDV = 2RB/(B-X): R = 10, X = 30% -> 28.571…
    assert.equal(fdvFromRaise(10n * WAD, 3000), (10n * WAD * TOTAL_SUPPLY) / (35n * 10n ** 25n));
    assert.equal(raiseFromFdv(fdvFromRaise(7n * WAD, 0), 0), 7n * WAD);
  });

  it("pool math rounds toward the pool", () => {
    const b = quoteBuy(1n, 10n * WAD, 35n * 10n ** 25n, 100);
    assert.equal(b.fee, 1n);
    assert.equal(b.tokensOut, 0n);
    const Q = 10n * WAD;
    const T = 35n * 10n ** 25n;
    const buy = quoteBuy(WAD, Q, T, 300);
    assert.ok(buy.newReserveQuote * buy.newReserveToken >= Q * T);
    const sell = quoteSell(buy.tokensOut, buy.newReserveQuote, buy.newReserveToken, 300);
    assert.ok(sell.newReserveQuote * sell.newReserveToken >= buy.newReserveQuote * buy.newReserveToken);
    assert.ok(sell.quoteOut < WAD);
    assert.equal(minOut(10_000n, 50), 9_950n);
    assert.ok(Math.abs(roundTripCost(100) - 0.0199) < 1e-12);
  });
});
