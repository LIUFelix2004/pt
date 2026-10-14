import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maxUint256 } from "viem";
import { advance, deployPortus, expectCustom, subPublic, WAD, type Portus } from "./helpers/fixture.js";

async function live(f: Portus, over: Parameters<Portus["launch"]>[0] = {}) {
  const l = await f.launch(over);
  await f.jumpTo(l.params.startTime);
  await subPublic(f, l, f.a, l.params.raiseTarget);
  await f.jumpTo(l.params.startTime + l.params.duration);
  await l.sale.write.finalize();
  await l.sale.write.claim({ account: f.a.account });
  return l;
}

const dl = async (f: Portus) => (await f.now()) + 3600n;

describe("economy edge guards", () => {
  it("pool liquidity: dust-sized adds/removes, slippage on remove, cumulative before opening", async () => {
    const f = await deployPortus();
    const pending = await f.launch();
    await expectCustom(f.viem, pending.pool.read.currentCumulativePrice(), pending.pool, "NotInitialized");

    const l = await live(f);
    await l.token.write.approve([l.pool.address, 10n ** 30n], { account: f.a.account });
    await f.fund(f.weth.address, f.a, l.pool.address, 2n ** 113n);
    // In a pool whose quote reserve exceeds its token reserve, 1 wei buys less than one share.
    const heavy = await live(f, { raiseTarget: 10n ** 27n, publicCap: 10n ** 28n });
    await f.fund(f.weth.address, f.a, heavy.pool.address, 1n);
    await heavy.token.write.approve([heavy.pool.address, 10n ** 30n], { account: f.a.account });
    await expectCustom(f.viem, heavy.pool.write.addLiquidity([1n, 10n ** 30n, 0n, f.a.account.address, await dl(f)], { account: f.a.account }), heavy.pool, "InsufficientOutput");
    await f.fund(f.weth.address, f.a, l.pool.address, 10n * WAD);

    await l.pool.write.addLiquidity([WAD, 10n ** 30n, 0n, f.a.account.address, await dl(f)], { account: f.a.account });
    const mine = await l.pool.read.sharesOf([f.a.account.address]);
    const total = await l.pool.read.totalShares();
    const [q] = await l.pool.read.getReserves();
    const quoteOut = (mine * BigInt(q)) / total;
    await f.viem.assertions.revertWithCustomErrorWithArgs(
      l.pool.write.removeLiquidity([mine, quoteOut + 1n, 0n, f.a.account.address, await dl(f)], { account: f.a.account }),
      l.pool,
      "SlippageExceeded",
      [quoteOut + 1n, quoteOut],
    );
    await expectCustom(f.viem, l.pool.write.removeLiquidity([mine, 0n, 10n ** 30n, f.a.account.address, await dl(f)], { account: f.a.account }), l.pool, "SlippageExceeded");
    // A single share is worth less than one wei of quote here.
    await expectCustom(f.viem, l.pool.write.removeLiquidity([1n, 0n, 0n, f.a.account.address, await dl(f)], { account: f.a.account }), l.pool, "InsufficientOutput");
  });

  it("flywheel views and degenerate buys", async () => {
    const f = await deployPortus();
    assert.deepEqual(await f.flywheel.read.twapMarketCap([f.outsider.account.address]), [false, 0n]);
    assert.deepEqual(await f.flywheel.read.roundOf([f.weth.address]), [0n, 0n, false, 0]);
    const l = await live(f);
    // A checkpoint taken in this very block yields no TWAP yet.
    await f.flywheel.write.checkpoint([l.pool.address]);
    assert.deepEqual(await f.flywheel.read.twapMarketCap([l.pool.address]), [false, 0n]);

    // Run a round whose only nominee has no short TWAP at execution: skipped, not bought.
    for (let d = 0; d < 7; d++) {
      await advance(f, 86_400n);
      await f.flywheel.write.checkpoint([l.pool.address]);
    }
    await f.flywheel.write.startRound([f.weth.address]);
    await f.flywheel.write.nominate([f.weth.address, l.pool.address]);
    // Fresh checkpoint < 1h old, older ones exist ⇒ TWAP from the previous day: fine.
    await advance(f, 12n * 3600n);
    const r = await f.flywheel.read.roundOf([f.weth.address]);
    assert.equal(r[2], true);
    await f.flywheel.write.executeRound([f.weth.address]);
    const skipped = await f.flywheel.getEvents.BuybackSkipped({}, { fromBlock: 0n });
    // No fees accrued (no trades) ⇒ zero budget ⇒ skipped.
    assert.equal(skipped.length, 1);
  });

  it("distributor views and treasury with nothing to spend", async () => {
    const f = await deployPortus();
    const pending = await f.launch();
    assert.equal(await f.distributor.read.released([pending.token.address]), 0n);
    const l = await live(f);
    await advance(f, 86_400n);
    const avail = await f.distributor.read.available([l.token.address, l.token.address]);
    await f.distributor.write.publishRoot([l.token.address, l.token.address, `0x${"ab".repeat(32)}`, avail, "x"], { account: f.publisher.account });
    const ep = await f.distributor.read.epochAt([l.token.address, l.token.address, 0n]);
    assert.equal(ep.total, avail);

    await l.treasury.write.startObservation();
    await advance(f, 1800n);
    await expectCustom(f.viem, l.treasury.write.executeBuyback([maxUint256, 0n]), l.treasury, "NothingToSpend");
  });
});
