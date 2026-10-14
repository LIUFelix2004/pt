import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quoteBuy as tsBuy, quoteSell as tsSell } from "@portus/shared";
import { deployPortus, expectCustom, subPublic, WAD, type Portus } from "./helpers/fixture.js";

/** A launch that filled exactly, so its pool is open at (10 WETH, qLp). */
async function openPool(f: Portus, feeBps = 100) {
  const l = await f.launch({ feeBps });
  await f.jumpTo(l.params.startTime);
  await subPublic(f, l, f.a, 10n * WAD);
  await f.jumpTo(l.params.startTime + l.params.duration);
  await l.sale.write.finalize();
  await l.sale.write.claim({ account: f.a.account });
  return l;
}

const later = async (f: Portus) => (await f.now()) + 3600n;

describe("PortusPool", () => {
  it("P-01 closed before initialize; initialize is sale-only and one-shot", async () => {
    const f = await deployPortus();
    const l = await f.launch();
    await f.fund(f.weth.address, f.b, l.pool.address, WAD);
    await expectCustom(f.viem, l.pool.write.buy([WAD, 0n, f.b.account.address, await later(f)], { account: f.b.account }), l.pool, "NotInitialized");
    await expectCustom(f.viem, l.pool.write.sell([1n, 0n, f.b.account.address, await later(f)], { account: f.b.account }), l.pool, "NotInitialized");
    await expectCustom(f.viem, l.pool.read.quoteBuy([WAD]), l.pool, "NotInitialized");
    await expectCustom(f.viem, l.pool.write.initialize([1n, 1n], { account: f.outsider.account }), l.pool, "NotSale");
    await f.jumpTo(l.params.startTime);
    await subPublic(f, l, f.a, 10n * WAD);
    await f.jumpTo(l.params.startTime + l.params.duration);
    await l.sale.write.finalize();
    assert.equal(await l.pool.read.initialized(), true);
  });

  it("P-02 initial shares = sqrt(Q·T), all booked to the locker", async () => {
    const f = await deployPortus();
    const l = await openPool(f);
    const [q, t] = await l.pool.read.getReserves();
    const shares = await l.pool.read.totalShares();
    assert.ok(shares * shares <= q * t && (shares + 1n) * (shares + 1n) > q * t);
    assert.equal(await l.pool.read.sharesOf([f.locker.address]), shares);
    assert.equal(await f.locker.read.lockedShares([l.pool.address]), shares);
    const ev = await f.locker.getEvents.LiquidityLocked({}, { fromBlock: 0n });
    assert.equal(ev[0]!.args.shares, shares);
  });

  it("P-03 buy/sell outputs match the shared TS math for every fee tier", async () => {
    const f = await deployPortus();
    for (const fee of [100, 200, 300, 400, 500]) {
      const l = await openPool(f, fee);
      for (const amount of [1234567n, 3n * WAD / 7n, 2n * WAD]) {
        const [q, t] = await l.pool.read.getReserves();
        const exp = tsBuy(amount, q, t, fee);
        const [out, feeQ] = await l.pool.read.quoteBuy([amount]);
        assert.equal(out, exp.tokensOut);
        assert.equal(feeQ, exp.fee);
        await f.fund(f.weth.address, f.b, l.pool.address, amount);
        await l.pool.write.buy([amount, out, f.b.account.address, await later(f)], { account: f.b.account });
        const [q2, t2] = await l.pool.read.getReserves();
        assert.equal(q2, exp.newReserveQuote);
        assert.equal(t2, exp.newReserveToken);
      }
      const bal = await l.token.read.balanceOf([f.b.account.address]);
      const [q, t] = await l.pool.read.getReserves();
      const exp = tsSell(bal / 2n, q, t, fee);
      const [out, feeQ] = await l.pool.read.quoteSell([bal / 2n]);
      assert.equal(out, exp.quoteOut);
      assert.equal(feeQ, exp.fee);
      await l.token.write.approve([l.pool.address, bal], { account: f.b.account });
      await l.pool.write.sell([bal / 2n, out, f.b.account.address, await later(f)], { account: f.b.account });
      const [q2, t2] = await l.pool.read.getReserves();
      assert.equal(q2, exp.newReserveQuote);
      assert.equal(t2, exp.newReserveToken);
    }
  });

  it("P-04 fees round up: a 1-wei buy pays 1 wei fee and gets nothing", async () => {
    const f = await deployPortus();
    const l = await openPool(f);
    assert.deepEqual(await l.pool.read.quoteBuy([1n]), [0n, 1n]);
    await f.fund(f.weth.address, f.b, l.pool.address, 1n);
    await expectCustom(f.viem, l.pool.write.buy([1n, 0n, f.b.account.address, await later(f)], { account: f.b.account }), l.pool, "InsufficientOutput");
  });

  it("P-05 slippage, deadline, recipient and zero-amount guards", async () => {
    const f = await deployPortus();
    const l = await openPool(f);
    await f.fund(f.weth.address, f.b, l.pool.address, WAD);
    const [out] = await l.pool.read.quoteBuy([WAD]);
    const o = { account: f.b.account };
    await f.viem.assertions.revertWithCustomErrorWithArgs(
      l.pool.write.buy([WAD, out + 1n, f.b.account.address, await later(f)], o),
      l.pool,
      "SlippageExceeded",
      [out + 1n, out],
    );
    await expectCustom(f.viem, l.pool.write.buy([WAD, 0n, f.b.account.address, (await f.now()) - 1n], o), l.pool, "Expired");
    for (const to of [l.pool.address, l.token.address, f.weth.address, "0x0000000000000000000000000000000000000000" as const]) {
      await expectCustom(f.viem, l.pool.write.buy([WAD, 0n, to, await later(f)], o), l.pool, "InvalidRecipient");
    }
    await expectCustom(f.viem, l.pool.write.buy([0n, 0n, f.b.account.address, await later(f)], o), l.pool, "ZeroAmount");
    // A different recipient is fine.
    await l.pool.write.buy([WAD, out, f.c.account.address, await later(f)], o);
    assert.equal(await l.token.read.balanceOf([f.c.account.address]), out);
  });

  it("P-06 reserves are capped below 2^112", async () => {
    const f = await deployPortus();
    const l = await openPool(f);
    const huge = 2n ** 113n;
    await f.fund(f.weth.address, f.b, l.pool.address, huge);
    await expectCustom(f.viem, l.pool.write.buy([huge, 1n, f.b.account.address, await later(f)], { account: f.b.account }), l.pool, "ReserveOverflow");
  });

  it("P-07 skim splits extra quote like a fee and burns extra tokens", async () => {
    const f = await deployPortus();
    const l = await openPool(f);
    const [q0, t0] = await l.pool.read.getReserves();
    await f.weth.write.mint([l.pool.address, 5n]);
    await l.token.write.transfer([l.pool.address, 1000n], { account: f.a.account });
    const supply = await l.token.read.totalSupply();
    await l.pool.write.skim({ account: f.outsider.account });
    // 5 wei: ecosystem 1, flywheel 1, creator 0, treasury the remaining 3.
    assert.equal(await f.weth.read.balanceOf([l.treasury.address]), 3n);
    assert.equal(await f.splitter.read.owed([f.weth.address, f.ecosystem.account.address]), 1n);
    assert.equal(await l.token.read.totalSupply(), supply - 1000n);
    const [q1, t1] = await l.pool.read.getReserves();
    assert.deepEqual([q1, t1], [q0, t0]);
  });

  it("P-08 TWAP accumulators follow the Uniswap V2 formula", async () => {
    const f = await deployPortus();
    const l = await openPool(f);
    const [q, t, ts] = await l.pool.read.getReserves();
    await f.jumpTo(BigInt(ts) + 99n);
    await f.fund(f.weth.address, f.b, l.pool.address, WAD);
    await l.pool.write.buy([WAD, 1n, f.b.account.address, await later(f)], { account: f.b.account });
    const [, , ts2] = await l.pool.read.getReserves();
    const elapsed = BigInt(ts2 - ts);
    const Q112 = 2n ** 112n;
    assert.equal(await l.pool.read.priceQuoteCumulativeLast(), ((q * Q112) / t) * elapsed);
    assert.equal(await l.pool.read.priceTokenCumulativeLast(), ((t * Q112) / q) * elapsed);
  });

  it("P-09 a round trip loses at least both fees and k never decreases", async () => {
    const f = await deployPortus();
    const l = await openPool(f, 300);
    const [q0, t0] = await l.pool.read.getReserves();
    const spend = 2n * WAD;
    await f.fund(f.weth.address, f.b, l.pool.address, spend);
    await l.pool.write.buy([spend, 1n, f.b.account.address, await later(f)], { account: f.b.account });
    const got = await l.token.read.balanceOf([f.b.account.address]);
    await l.token.write.approve([l.pool.address, got], { account: f.b.account });
    await l.pool.write.sell([got, 1n, f.b.account.address, await later(f)], { account: f.b.account });
    const back = await f.weth.read.balanceOf([f.b.account.address]);
    // 1 - (1 - 3%)^2 = 5.91%
    assert.ok(back * 10_000n <= spend * 9_409n, `got back ${back}`);
    const [q1, t1] = await l.pool.read.getReserves();
    assert.ok(q1 * t1 >= q0 * t0);
    const fees = (await l.pool.getEvents.FeePaid({}, { fromBlock: 0n })).reduce((s, e) => s + e.args.amount!, 0n);
    const routed = (await f.weth.read.balanceOf([l.treasury.address])) + (await f.splitter.read.accounted([f.weth.address]));
    assert.equal(routed, fees);
  });
});
