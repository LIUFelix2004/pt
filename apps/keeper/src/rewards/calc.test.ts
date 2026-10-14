import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cappedWithin,
  competitionRankWeights,
  icbrt,
  mintDayAllocation,
  radarAllocation,
  referralPower,
  timeWeighted,
  treasuryAllocation,
  type BalanceEvent,
} from "./calc.js";

const ev = (ts: number, account: string, delta: bigint, order = 0n): BalanceEvent => ({ ts, account, delta, order });

describe("rewards calc", () => {
  it("timeWeighted integrates balances over the window, including opening balances", () => {
    const events = [ev(0, "a", 100n), ev(50, "b", 10n), ev(150, "a", -100n), ev(150, "b", 100n, 1n)];
    const tw = timeWeighted(events, 100, 200);
    // a: 100 from 100..150 = 5000. b: 10 from 100..150 (500) + 110 from 150..200 (5500).
    assert.equal(tw.get("a"), 5000n);
    assert.equal(tw.get("b"), 6000n);
  });

  it("a buy-before-snapshot, sell-after pattern earns almost nothing", () => {
    const events = [ev(0, "holder", 1000n), ev(199, "flipper", 1_000_000n), ev(199, "flipper", -1_000_000n, 1n)];
    const tw = timeWeighted(events, 100, 200);
    assert.equal(tw.get("flipper"), undefined);
    assert.equal(tw.get("holder"), 100_000n);
  });

  it("cappedWithin caps per address, then scales to the budget", () => {
    const out = cappedWithin(new Map([["a", 500n], ["b", 50n]]), 100n, 1_000n);
    assert.deepEqual([...out], [["a", 100n], ["b", 50n]]);
    const scaled = cappedWithin(new Map([["a", 100n], ["b", 100n]]), 100n, 100n);
    assert.equal((scaled.get("a") ?? 0n) + (scaled.get("b") ?? 0n), 100n);
  });

  it("radar never allocates more than the budget and splits by component weights", () => {
    const budget = 1_000_000n;
    const a = radarAllocation({
      budget,
      lpEvents: [ev(0, "lp", 10n)],
      tokenEvents: [ev(0, "holder", 500n), ev(0, "pool", 10_000n)],
      feesByTrader: new Map([["trader", 10_000n], ["invitee", 10_000n]]),
      referrerOf: new Map([["invitee", "inviter"]]),
      priceNum: 1n,
      priceDen: 10n,
      excluded: new Set(["pool"]),
      from: 0,
      to: 86_400,
    });
    assert.ok(a.total <= budget);
    assert.equal(a.components.lp.get("lp"), 400_000n);
    assert.equal(a.components.holding.get("holder"), 300_000n);
    assert.equal(a.components.holding.get("pool"), undefined);
    // rebate: 10% of 10,000 quote = 1,000 quote = 10,000 tokens, capped at 1% of budget = 10,000.
    assert.equal(a.components.rebate.get("trader"), 10_000n);
    assert.equal(a.components.referral.get("inviter"), 10_000n);
    // Only the direct inviter is paid; nobody above it.
    assert.equal([...a.components.referral.keys()].length, 1);
  });

  it("treasury rewards split the funded amount by TWAB, excluding contracts", () => {
    const r = treasuryAllocation(1_000n, [ev(0, "x", 3n), ev(0, "y", 1n), ev(0, "treasury", 100n)], new Set(["treasury"]), 0, 10);
    assert.equal(r.byAccount.get("x"), 750n);
    assert.equal(r.byAccount.get("y"), 250n);
    assert.equal(r.total, 1_000n);
  });

  it("mint: competition rank weights ties equally and skips the next rank", () => {
    const w = competitionRankWeights(new Map([["a", 5n], ["b", 10n], ["c", 10n], ["d", 20n], ["z", 0n]]));
    assert.deepEqual([...w].sort(), [["a", 1n], ["b", 2n], ["c", 2n], ["d", 4n]]);
  });

  it("mint: icbrt is the exact integer cube root", () => {
    for (const n of [0n, 1n, 7n, 8n, 26n, 27n, 10n ** 30n, 10n ** 30n - 1n, 123456789012345678901234567890n]) {
      const r = icbrt(n);
      assert.ok(r ** 3n <= n && (r + 1n) ** 3n > n, `cbrt ${n}`);
    }
  });

  it("mint: referral power takes the cube root of the largest zone and ×10 / step rule for the rest", () => {
    const T = 10n ** 18n;
    // Zones 8000, 20000, 500 tokens: largest (20000) → cbrt = 27.14..; 8000 → 80000; 500 → 5000.
    const p = referralPower([8000n * T, 20_000n * T, 500n * T]);
    const largest = icbrt(20_000n * T * 10n ** 36n);
    assert.equal(p, largest + 80_000n * T + 5_000n * T);
    // Above the 10,000 step: 10,000·10 + remainder.
    assert.equal(referralPower([1n * T, 15_000n * T]) - icbrt(15_000n * T * 10n ** 36n), 1n * T * 10n);
    assert.equal(referralPower([30_000n * T, 12_000n * T]) - icbrt(30_000n * T * 10n ** 36n), 100_000n * T + 2_000n * T);
    assert.equal(referralPower([]), 0n);
  });

  it("mint: day allocation splits static by rank and dynamic by single-level referral power", () => {
    const T = 10n ** 18n;
    const events = [
      ev(0, "a", 100n * T),
      ev(0, "b", 200n * T),
      ev(0, "c", 300n * T),
      ev(0, "pool", 1_000_000n * T),
      ev(0, "dust", 1n),
    ];
    const out = mintDayAllocation({
      amount: 1000n * T,
      staticBps: 5000n,
      tokenEvents: events,
      // b invited a and c; a invited nobody. c's own invitee would not count for b (single level).
      referrerOf: new Map([["a", "b"], ["c", "b"]]),
      excluded: new Set(["pool"]),
      minHolding: T,
      from: 100,
      to: 200,
    });
    // Static: ranks a=1, b=2, c=3 → 500 · (1,2,3)/6.
    assert.equal(out.components.static.get("a"), (500n * T * 1n) / 6n);
    assert.equal(out.components.static.get("c"), (500n * T * 3n) / 6n);
    assert.equal(out.components.static.get("dust"), undefined);
    // Dynamic: only b has power, so b takes the whole dynamic half.
    assert.equal(out.components.dynamic.get("b"), 500n * T);
    assert.ok(out.total <= 1000n * T);
  });
});
