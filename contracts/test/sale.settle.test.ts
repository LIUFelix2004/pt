import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maxUint128, zeroAddress } from "viem";
import { allocation, settle, type SaleTerms } from "@portus/shared";
import {
  deployPortus,
  expectCustom,
  subPublic,
  Outcome,
  Phase,
  Rule,
  S,
  WAD,
  type LaunchHandle,
  type Portus,
} from "./helpers/fixture.js";

async function terms(l: LaunchHandle): Promise<SaleTerms> {
  return {
    raiseTarget: await l.sale.read.raiseTarget(),
    qSale: await l.sale.read.qSale(),
    qLp: await l.sale.read.qLp(),
    qInc: await l.sale.read.qInc(),
    priceNum: await l.sale.read.priceNum(),
    priceDen: await l.sale.read.priceDen(),
    underRule: (await l.sale.read.underRule()) === Rule.SHRINK ? "SHRINK" : "REFUND",
    minFillBps: await l.sale.read.minFillBps(),
  };
}

/** Run a sale with the given commitments, finalize, and return everything needed to check it. */
async function runSale(f: Portus, l: LaunchHandle, commits: Array<[Portus["a"], bigint]>) {
  await f.jumpTo(l.params.startTime);
  for (const [w, amt] of commits) await subPublic(f, l, w, amt);
  await f.jumpTo(l.params.startTime + l.params.duration);
  const t = await terms(l);
  const C = commits.reduce((s, [, x]) => s + x, 0n);
  const expected = settle(C, t);
  const preview = await l.sale.read.previewSettlement();
  await l.sale.write.finalize();
  return { t, C, expected, preview };
}

async function usdQuote(f: Portus) {
  const usd = await f.viem.deployContract("MockERC20", ["USD Coin", "USD", 6]);
  await f.factory.write.setQuoteAsset([usd.address, true, true, 1n, maxUint128, zeroAddress, 0n]);
  return usd;
}

describe("PortusSale settlement", () => {
  it("S-07 oversubscribed example (§3.8): tokens, refunds, dust and pool match exactly", async () => {
    const f = await deployPortus();
    const l = await f.launch({ raiseTarget: 10n * WAD, incentiveBps: 3000 });
    const c = [10n * WAD, 7n * WAD + 3n, 8n * WAD - 3n];
    const { expected, preview } = await runSale(f, l, [
      [f.a, c[0]!],
      [f.b, c[1]!],
      [f.c, c[2]!],
    ]);
    assert.equal(preview[0], Outcome.FILLED);
    assert.equal(await l.sale.read.outcome(), Outcome.FILLED);
    assert.equal(await l.sale.read.phase(), Phase.SUCCEEDED);

    const tokens = [140000000000000000000000000n, 98000000000000000042000000n, 111999999999999999958000000n];
    const refunds = [6n * WAD, 4200000000000000001n, 4799999999999999998n];
    const wallets = [f.a, f.b, f.c];
    for (let i = 0; i < 3; i++) {
      const [pt, pr] = await l.sale.read.previewClaim([wallets[i]!.account.address]);
      assert.equal(pt, tokens[i]);
      assert.equal(pr, refunds[i]);
      await l.sale.write.claim({ account: wallets[i]!.account });
      assert.equal(await l.token.read.balanceOf([wallets[i]!.account.address]), tokens[i]);
      assert.equal(await f.weth.read.balanceOf([wallets[i]!.account.address]), refunds[i]);
    }
    assert.equal(tokens.reduce((a, b) => a + b), 350000000000000000000000000n);
    assert.equal(refunds.reduce((a, b) => a + b), 15n * WAD - 1n);

    const [q, t] = await l.pool.read.getReserves();
    assert.equal(q, 10n ** 19n);
    assert.equal(t, 35n * 10n ** 25n);
    assert.equal(expected.poolQuote, q);
    assert.equal((await f.distributor.read.launchOf([l.token.address]))[4], 3n * 10n ** 26n);

    // 1 wei of quote dust; swept to the launch treasury once everyone has claimed.
    await l.sale.write.sweepDust();
    assert.equal(await f.weth.read.balanceOf([l.treasury.address]), 1n);
    assert.equal(await l.token.read.balanceOf([l.sale.address]), 0n);
  });

  it("S-08 exactly filled: no refunds, token dust < n", async () => {
    const f = await deployPortus();
    const l = await f.launch();
    await runSale(f, l, [
      [f.a, 3n * WAD + 1n],
      [f.b, 7n * WAD - 1n],
    ]);
    assert.equal(await l.sale.read.outcome(), Outcome.FILLED);
    assert.equal(await l.sale.read.quoteForRefunds(), 0n);
    let sum = 0n;
    for (const w of [f.a, f.b]) {
      const [tok, ref] = await l.sale.read.previewClaim([w.account.address]);
      assert.equal(ref, 0n);
      sum += tok;
    }
    const qSale = await l.sale.read.qSale();
    assert.ok(qSale - sum < 2n && qSale >= sum);
  });

  it("S-09 a single subscriber oversubscribes alone", async () => {
    const f = await deployPortus();
    const l = await f.launch();
    await runSale(f, l, [[f.a, 25n * WAD]]);
    const [tok, ref] = await l.sale.read.previewClaim([f.a.account.address]);
    assert.equal(tok, await l.sale.read.qSale());
    assert.equal(ref, 15n * WAD);
  });

  it("S-10 REFUND rule below target: full refunds, all supply burned, pool never opens", async () => {
    const f = await deployPortus();
    const l = await f.launch({ underRule: Rule.REFUND });
    await runSale(f, l, [
      [f.a, 3n * WAD],
      [f.b, 2n * WAD],
    ]);
    assert.equal(await l.sale.read.outcome(), Outcome.REFUNDED);
    assert.equal(await l.sale.read.phase(), Phase.REFUNDING);
    assert.equal(await l.token.read.totalSupply(), 0n);
    await l.sale.write.claim({ account: f.a.account });
    assert.equal(await f.weth.read.balanceOf([f.a.account.address]), 3n * WAD);
    await f.fund(f.weth.address, f.c, l.pool.address, WAD);
    await expectCustom(f.viem, l.pool.write.buy([WAD, 0n, f.c.account.address, (await f.now()) + 99n], { account: f.c.account }), l.pool, "NotInitialized");
    await expectCustom(f.viem, l.sale.write.sweepDust(), l.sale, "NotSettled");
  });

  it("S-11 nobody subscribed: finalize succeeds and burns everything", async () => {
    const f = await deployPortus();
    const l = await f.launch({ underRule: Rule.SHRINK });
    await runSale(f, l, []);
    assert.equal(await l.sale.read.outcome(), Outcome.REFUNDED);
    assert.equal(await l.token.read.totalSupply(), 0n);
  });

  it("S-12 SHRINK example (§3.8): incentive pool kept whole; r > 1 dust goes to the treasury", async () => {
    const f = await deployPortus();
    const l = await f.launch({ underRule: Rule.SHRINK, minFillBps: 4000 });
    const C = 42n * 10n ** 17n + 7n;
    const { expected } = await runSale(f, l, [[f.a, C]]);
    assert.equal(await l.sale.read.outcome(), Outcome.SHRUNK);
    const [q, t] = await l.pool.read.getReserves();
    assert.equal(q, C);
    assert.equal(t, 147000000000000000245000000n);
    const [tok, ref] = await l.sale.read.previewClaim([f.a.account.address]);
    assert.equal(tok, 147000000000000000245000000n);
    assert.equal(ref, 0n);
    // Portus docs: only the unused sale + LP sides burn; incentives stay whole.
    assert.equal((await f.distributor.read.launchOf([l.token.address]))[4], 3n * 10n ** 26n);
    assert.equal(expected.incentive, 3n * 10n ** 26n);
    assert.equal(expected.burn, (35n * 10n ** 25n - 147000000000000000245000000n) * 2n);
    assert.equal(await l.token.read.totalSupply(), S - expected.burn);

    // r = 3, s = 3.5e20 with a 6-decimal quote.
    const usd = await usdQuote(f);
    const l2 = await f.launch({ quoteAsset: usd.address, raiseTarget: 3_000_000n, underRule: Rule.SHRINK });
    assert.equal(await l2.sale.read.priceNum(), 3n);
    const C2 = 1_500_002n;
    const r2 = await runSale(f, l2, [
      [f.a, 1_000_001n],
      [f.b, 500_001n],
    ]);
    assert.equal(await l2.sale.read.outcome(), Outcome.SHRUNK);
    assert.equal(r2.expected.quoteDust, 2n);
    assert.equal(await usd.read.balanceOf([l2.treasury.address]), 2n);
    const [q2, t2] = await l2.pool.read.getReserves();
    assert.equal(q2, 1_500_000n);
    assert.equal(q2 * (await l2.sale.read.priceDen()), t2 * 3n);
    const ta = allocation(1_000_001n, C2, "SHRUNK", r2.t);
    assert.equal((await l2.sale.read.previewClaim([f.a.account.address]))[0], ta.tokens);
  });

  it("S-13 SHRINK below minFillBps refunds; exactly at it shrinks", async () => {
    const f = await deployPortus();
    const below = await f.launch({ underRule: Rule.SHRINK, minFillBps: 5000 });
    await runSale(f, below, [[f.a, 5n * WAD - 1n]]);
    assert.equal(await below.sale.read.outcome(), Outcome.REFUNDED);

    const at = await f.launch({ underRule: Rule.SHRINK, minFillBps: 5000 });
    await runSale(f, at, [[f.b, 5n * WAD]]);
    assert.equal(await at.sale.read.outcome(), Outcome.SHRUNK);
  });

  it("S-14 SHRINK with k = 0 (C < r) refunds", async () => {
    const f = await deployPortus();
    const usd = await usdQuote(f);
    const l = await f.launch({ quoteAsset: usd.address, raiseTarget: 3_000_000n, underRule: Rule.SHRINK });
    await runSale(f, l, [[f.a, 2n]]);
    assert.equal(await l.sale.read.outcome(), Outcome.REFUNDED);
  });

  it("S-15 finalize only after the end, and only once", async () => {
    const f = await deployPortus();
    const l = await f.launch();
    await expectCustom(f.viem, l.sale.write.finalize(), l.sale, "NotAwaitingFinalize");
    await f.jumpTo(l.params.startTime);
    await subPublic(f, l, f.a, 10n * WAD);
    await expectCustom(f.viem, l.sale.write.finalize(), l.sale, "NotAwaitingFinalize");
    await f.jumpTo(l.params.startTime + l.params.duration);
    await l.sale.write.finalize({ account: f.outsider.account });
    await expectCustom(f.viem, l.sale.write.finalize(), l.sale, "NotAwaitingFinalize");
    const ev = await l.sale.getEvents.Finalized({}, { fromBlock: 0n });
    assert.equal(ev.length, 1);
    assert.equal(ev[0]!.args.outcome, Outcome.FILLED);
  });

  it("S-16 opening price equals the subscription price: Q·s == T·r", async () => {
    const f = await deployPortus();
    for (const [rule, amount] of [
      [Rule.REFUND, 13n * WAD],
      [Rule.SHRINK, 6n * WAD + 123n],
    ] as const) {
      const l = await f.launch({ underRule: rule });
      await runSale(f, l, [[f.a, amount]]);
      const [q, t] = await l.pool.read.getReserves();
      assert.equal(q * (await l.sale.read.priceDen()), t * (await l.sale.read.priceNum()));
      assert.equal(await f.locker.read.lockedShares([l.pool.address]), await l.pool.read.totalShares());
    }
  });

  it("S-17 donations before finalize do not move the opening price", async () => {
    const f = await deployPortus();
    const l = await f.launch();
    await f.weth.write.mint([l.pool.address, 7n * WAD]);
    await f.weth.write.mint([l.sale.address, 3n * WAD]);
    await runSale(f, l, [[f.a, 10n * WAD]]);
    const [q, t] = await l.pool.read.getReserves();
    assert.equal(q, 10n * WAD);
    assert.equal(t, await l.sale.read.qLp());
    // Skimmed quote is split like a fee: 60% to the treasury (creator share 0), 40% booked.
    await l.pool.write.skim();
    assert.equal(await f.weth.read.balanceOf([l.treasury.address]), (7n * WAD * 6n) / 10n);
    assert.equal(await f.splitter.read.accounted([f.weth.address]), (7n * WAD * 4n) / 10n);
    await l.sale.write.claim({ account: f.a.account });
    await l.sale.write.sweepDust();
    assert.equal(await f.weth.read.balanceOf([l.treasury.address]), (7n * WAD * 6n) / 10n + 3n * WAD);
  });

  it("S-20 incentive funding: full when filled, scaled when shrunk, skipped at X = 0", async () => {
    const f = await deployPortus();
    const zero = await f.launch({ incentiveBps: 0 });
    await runSale(f, zero, [[f.a, 10n * WAD]]);
    assert.equal((await f.distributor.read.launchOf([zero.token.address]))[4], 0n);
    assert.equal((await f.distributor.getEvents.IncentiveFunded({}, { fromBlock: 0n })).length, 0);
  });

  it("S-21 reentrant quote asset cannot re-enter claim, finalize or buy", async () => {
    const f = await deployPortus();
    const q = await f.viem.deployContract("MockReentrantERC20");
    await f.factory.write.setQuoteAsset([q.address, true, false, 1n, maxUint128, zeroAddress, 0n]);
    const l = await f.launch({ quoteAsset: q.address });
    await f.jumpTo(l.params.startTime);
    for (const w of [f.a, f.b]) {
      await q.write.mint([w.account.address, 10n * WAD]);
      await q.write.approve([l.sale.address, 10n * WAD], { account: w.account });
      await l.sale.write.subscribePublic([10n * WAD], { account: w.account });
    }
    await f.jumpTo(l.params.startTime + l.params.duration);

    await q.write.arm([l.sale.address, 2]); // FINALIZE
    await l.sale.write.finalize();
    assert.equal(await q.read.reentered(), true);
    assert.equal(await q.read.reentrySucceeded(), false);

    await q.write.arm([l.sale.address, 1]); // CLAIM (fires on the refund transfer)
    await l.sale.write.claim({ account: f.a.account });
    assert.equal(await q.read.reentered(), true);
    assert.equal(await q.read.reentrySucceeded(), false);

    await q.write.mint([f.c.account.address, WAD]);
    await q.write.approve([l.pool.address, WAD], { account: f.c.account });
    await q.write.arm([l.pool.address, 3]); // BUY
    await l.pool.write.buy([WAD, 1n, f.c.account.address, (await f.now()) + 99n], { account: f.c.account });
    assert.equal(await q.read.reentered(), true);
    assert.equal(await q.read.reentrySucceeded(), false);
  });
});
