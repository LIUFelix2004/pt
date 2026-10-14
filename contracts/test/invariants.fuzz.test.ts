import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maxUint128, zeroAddress } from "viem";
import { alignRaiseTarget, settle, type SaleTerms } from "@portus/shared";
import { deployPortus, Outcome, Rule, S, WAD, type Portus } from "./helpers/fixture.js";

// Reproducible: FUZZ_SEED picks the sequence, FUZZ_RUNS / FUZZ_STEPS its size.
// Local default is small so `npm test` stays quick; CI runs FUZZ_RUNS=500 FUZZ_STEPS=50.
const SEED = Number(process.env.FUZZ_SEED ?? 0x5eed);
const RUNS = Number(process.env.FUZZ_RUNS ?? 24);
const STEPS = Number(process.env.FUZZ_STEPS ?? 30);

function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const big = (lo: bigint, hi: bigint) => {
    const span = hi - lo + 1n;
    let x = 0n;
    for (let i = 0; i < 4; i++) x = (x << 32n) | BigInt(Math.floor(next() * 2 ** 32));
    return lo + (x % span);
  };
  const pick = <T>(xs: readonly T[]) => xs[int(0, xs.length - 1)]!;
  return { next, int, big, pick };
}

describe("Portus invariants (seeded fuzz)", () => {
  it(`I-01..I-13 hold over ${RUNS} random launches × ${STEPS} steps (seed ${SEED})`, async () => {
    const f = await deployPortus();
    const rnd = prng(SEED);
    const usd = await f.viem.deployContract("MockERC20", ["USD", "USD", 6]);
    await f.factory.write.setQuoteAsset([usd.address, true, true, 1n, maxUint128, zeroAddress, 0n]);
    const people = f.wallets.slice(1, 10);

    for (let run = 0; run < RUNS; run++) {
      const ctx = `run ${run} seed ${SEED}`;
      const six = rnd.next() < 0.4;
      const quote = six ? usd.address : f.weth.address;
      const unit = six ? 10n ** 6n : WAD;
      const x = rnd.pick([0, 1000, 2500, 3000, rnd.int(0, 3000)]);
      const rawR = rnd.big(unit, 50n * unit) + (rnd.next() < 0.5 ? rnd.big(0n, 10n ** 6n) : 0n);
      const R = alignRaiseTarget(rawR, x);
      const rule = rnd.next() < 0.5 ? Rule.SHRINK : Rule.REFUND;
      const minFill = rule === Rule.SHRINK ? rnd.pick([0, 2500, 5000, rnd.int(0, 10_000)]) : 0;
      const l = await f.launch({
        quoteAsset: quote,
        raiseTarget: R,
        incentiveBps: x,
        feeBps: rnd.pick([100, 200, 300, 400, 500]),
        underRule: rule,
        minFillBps: minFill,
        publicCap: 2n ** 120n,
      });
      const q = await f.viem.getContractAt("MockERC20", quote);

      // Subscriptions: anything from nobody to heavy oversubscription.
      await f.jumpTo(l.params.startTime);
      const scale = rnd.pick([0n, 1n, 2n, 5n, 10n, 30n]);
      const commits = new Map<string, bigint>();
      const subs = rnd.int(0, people.length);
      for (let i = 0; i < subs; i++) {
        const w = rnd.pick(people);
        const amt = rnd.big(1n, (R * (scale + 1n)) / BigInt(Math.max(subs, 1)) + 3n);
        await f.fund(quote, w, l.sale.address, amt);
        await l.sale.write.subscribePublic([amt], { account: w.account });
        const k = w.account.address.toLowerCase();
        commits.set(k, (commits.get(k) ?? 0n) + amt);
      }
      // Donations to the pool before finalize must not move the opening price.
      if (rnd.next() < 0.3) await q.write.mint([l.pool.address, rnd.big(1n, unit)]);

      await f.jumpTo(l.params.startTime + l.params.duration);
      const C = [...commits.values()].reduce((a, b) => a + b, 0n);
      const terms: SaleTerms = {
        raiseTarget: R,
        qSale: await l.sale.read.qSale(),
        qLp: await l.sale.read.qLp(),
        qInc: await l.sale.read.qInc(),
        priceNum: await l.sale.read.priceNum(),
        priceDen: await l.sale.read.priceDen(),
        underRule: rule === Rule.SHRINK ? "SHRINK" : "REFUND",
        minFillBps: minFill,
      };
      const expected = settle(C, terms);
      const supply0 = await l.token.read.totalSupply();
      await l.sale.write.finalize();
      const outcome = await l.sale.read.outcome();
      assert.equal(Outcome[outcome], expected.outcome, ctx);
      const n = BigInt(commits.size);
      const live = outcome === Outcome.FILLED || outcome === Outcome.SHRUNK;

      // I-04 opening price
      if (live) {
        const [rq, rt] = await l.pool.read.getReserves();
        assert.equal(rq * terms.priceDen, rt * terms.priceNum, `${ctx}: I-04`);
        assert.equal(rq, expected.poolQuote, ctx);
      } else {
        assert.equal(await l.pool.read.initialized(), false, ctx);
      }
      // I-06 dust bounds (quote side at finalize)
      if (outcome === Outcome.SHRUNK) assert.ok(expected.quoteDust < terms.priceNum, `${ctx}: I-06`);

      // Random interleaving of claims and trades.
      const unclaimed = new Set(commits.keys());
      const received = new Map<string, { tokens: bigint; refund: bigint }>();
      // Value per share: Q·T / shares² never decreases (swaps raise k; adds and
      // removes round in the pool's favour).
      let lastQT = 0n;
      let lastS2 = 1n;
      let lastSupply = await l.token.read.totalSupply();
      assert.ok(lastSupply <= supply0, `${ctx}: I-10`);
      const deadline = () => f.now().then((t) => t + 3600n);

      const solvency = async () => {
        // I-01 the sale can always pay every unclaimed entitlement
        let needT = 0n;
        let needQ = 0n;
        for (const k of unclaimed) {
          const [t, r] = await l.sale.read.previewClaim([k as `0x${string}`]);
          needT += t;
          needQ += r;
        }
        assert.ok((await l.token.read.balanceOf([l.sale.address])) >= needT, `${ctx}: I-01 tokens`);
        assert.ok((await q.read.balanceOf([l.sale.address])) >= needQ, `${ctx}: I-01 quote`);
      };
      await solvency();

      for (let step = 0; step < STEPS; step++) {
        const roll = rnd.next();
        if (roll < 0.35 && unclaimed.size > 0) {
          const k = rnd.pick([...unclaimed]);
          const w = people.find((p) => p.account.address.toLowerCase() === k)!;
          const tb = await l.token.read.balanceOf([w.account.address]);
          const qb = await q.read.balanceOf([w.account.address]);
          // Anyone may trigger it; assets go to the account.
          await l.sale.write.claimFor([w.account.address], { account: rnd.pick(people).account });
          received.set(k, {
            tokens: (await l.token.read.balanceOf([w.account.address])) - tb,
            refund: (await q.read.balanceOf([w.account.address])) - qb,
          });
          unclaimed.delete(k);
        } else if (live && roll < 0.7) {
          const w = rnd.pick(people);
          const amt = rnd.big(1n, unit * 5n);
          await f.fund(quote, w, l.pool.address, amt);
          const [out] = await l.pool.read.quoteBuy([amt]);
          if (out > 0n) await l.pool.write.buy([amt, out, w.account.address, await deadline()], { account: w.account });
        } else if (live && roll < 0.78) {
          // Third-party liquidity: add, or remove some of what this account holds.
          const w = rnd.pick(people);
          const mine = await l.pool.read.sharesOf([w.account.address]);
          if (mine > 0n && rnd.next() < 0.5) {
            const sh = rnd.big(1n, mine);
            const total = await l.pool.read.totalShares();
            const [rq, rt] = await l.pool.read.getReserves();
            if ((sh * BigInt(rq)) / total > 0n && (sh * BigInt(rt)) / total > 0n) {
              await l.pool.write.removeLiquidity([sh, 0n, 0n, w.account.address, await deadline()], { account: w.account });
            }
          } else {
            const amt = rnd.big(unit / 1000n + 1n, unit * 3n);
            const [rq, rt] = await l.pool.read.getReserves();
            const need = (amt * BigInt(rt) + BigInt(rq) - 1n) / BigInt(rq);
            const bal = await l.token.read.balanceOf([w.account.address]);
            if (need > 0n && need <= bal && (amt * (await l.pool.read.totalShares())) / BigInt(rq) > 0n) {
              await f.fund(quote, w, l.pool.address, amt);
              await l.token.write.approve([l.pool.address, need], { account: w.account });
              await l.pool.write.addLiquidity([amt, need, 0n, w.account.address, await deadline()], { account: w.account });
            }
          }
        } else if (live && roll < 0.93) {
          const w = rnd.pick(people);
          const bal = await l.token.read.balanceOf([w.account.address]);
          const amt = bal === 0n ? 0n : rnd.big(1n, bal);
          if (amt > 0n) {
            const [out] = await l.pool.read.quoteSell([amt]);
            if (out > 0n) {
              await l.token.write.approve([l.pool.address, amt], { account: w.account });
              await l.pool.write.sell([amt, out, w.account.address, await deadline()], { account: w.account });
            }
          }
        } else if (live) {
          await l.pool.write.skim({ account: rnd.pick(people).account });
        }

        if (live) {
          const [rq, rt] = await l.pool.read.getReserves();
          const qt = BigInt(rq) * BigInt(rt);
          const total = await l.pool.read.totalShares();
          const s2 = total * total;
          assert.ok(qt * lastS2 >= lastQT * s2, `${ctx}: I-07 value per share decreased at step ${step}`);
          lastQT = qt;
          lastS2 = s2;
          assert.ok((await q.read.balanceOf([l.pool.address])) >= rq, `${ctx}: I-08 quote`);
          assert.ok((await l.token.read.balanceOf([l.pool.address])) >= rt, `${ctx}: I-08 token`);
          // I-09 the genesis LP stays locked: the Locker's shares never change.
          const locked = await l.pool.read.lockedShares();
          assert.equal(await l.pool.read.sharesOf([f.locker.address]), locked, `${ctx}: I-09`);
          assert.ok(locked <= total, `${ctx}: I-09 total`);
          // I-13 fee books: the splitter holds at least what it owes.
          assert.ok((await q.read.balanceOf([f.splitter.address])) >= (await f.splitter.read.accounted([quote])), `${ctx}: I-13`);
        }
        const supply = await l.token.read.totalSupply();
        assert.ok(supply <= lastSupply, `${ctx}: I-10`);
        lastSupply = supply;
      }

      // Drain the remaining claims, then sweep.
      for (const k of [...unclaimed]) {
        const w = people.find((p) => p.account.address.toLowerCase() === k)!;
        const tb = await l.token.read.balanceOf([w.account.address]);
        const qb = await q.read.balanceOf([w.account.address]);
        await l.sale.write.claim({ account: w.account });
        received.set(k, {
          tokens: (await l.token.read.balanceOf([w.account.address])) - tb,
          refund: (await q.read.balanceOf([w.account.address])) - qb,
        });
        unclaimed.delete(k);
      }
      await solvency();

      let sweptTokens = 0n;
      let sweptQuote = 0n;
      if (live) {
        sweptTokens = await l.token.read.balanceOf([l.sale.address]);
        sweptQuote = await q.read.balanceOf([l.sale.address]);
        await l.sale.write.sweepDust();
      }

      // I-02 quote conservation and I-12 no privileged withdrawal: every unit
      // committed went to the pool, back to a subscriber, or to the sink as dust.
      const sumRefund = [...received.values()].reduce((a, b) => a + b.refund, 0n);
      const sumTokens = [...received.values()].reduce((a, b) => a + b.tokens, 0n);
      assert.equal(C, expected.poolQuote + sumRefund + expected.quoteDust + sweptQuote, `${ctx}: I-02`);

      // I-03 token conservation
      const burned = (await l.sale.read.tokensBurned()) + sweptTokens;
      assert.equal(S, expected.poolTokens + sumTokens + expected.incentive + burned, `${ctx}: I-03`);

      // I-05 nobody gets tokens below the price; I-06 dust < n on FILLED.
      for (const [k, got] of received) {
        const paid = commits.get(k)! - got.refund;
        assert.ok(paid * terms.priceDen >= got.tokens * terms.priceNum, `${ctx}: I-05 ${k}`);
      }
      if (outcome === Outcome.FILLED) {
        assert.ok(sweptTokens < n && sweptQuote < n, `${ctx}: I-06`);
      }

      // I-11 settlement is final.
      assert.equal(await l.sale.read.outcome(), outcome, `${ctx}: I-11`);
    }
  });
});
