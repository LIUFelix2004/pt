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
  return l;
}

/** Trade back and forth so the treasury accumulates fee share without moving the price much. */
async function churn(f: Portus, l: Awaited<ReturnType<typeof live>>, rounds = 3) {
  const dl = async () => (await f.now()) + 3600n;
  for (let i = 0; i < rounds; i++) {
    await f.fund(f.weth.address, f.b, l.pool.address, 2n * WAD);
    await l.pool.write.buy([2n * WAD, 1n, f.b.account.address, await dl()], { account: f.b.account });
    const bal = await l.token.read.balanceOf([f.b.account.address]);
    await l.token.write.approve([l.pool.address, bal], { account: f.b.account });
    await l.pool.write.sell([bal, 1n, f.b.account.address, await dl()], { account: f.b.account });
  }
}

describe("PortusTreasury", () => {
  it("TR-01 buyback: anyone can trigger it after the TWAP window; tokens are burned", async () => {
    const f = await deployPortus();
    const l = await live(f);
    await expectCustom(f.viem, l.treasury.write.executeBuyback([maxUint256, 0n]), l.treasury, "ObservationNotReady");
    await l.treasury.write.startObservation({ account: f.outsider.account });
    await expectCustom(f.viem, l.treasury.write.startObservation(), l.treasury, "AlreadyObserving");
    await churn(f, l);
    await expectCustom(f.viem, l.treasury.write.executeBuyback([maxUint256, 0n]), l.treasury, "ObservationNotReady");
    await advance(f, 30n * 60n);

    const balBefore = await f.weth.read.balanceOf([l.treasury.address]);
    const supplyBefore = await l.token.read.totalSupply();
    assert.ok(balBefore > 0n);
    await l.treasury.write.executeBuyback([maxUint256, 0n], { account: f.outsider.account });
    const [ev] = await l.treasury.getEvents.Buyback({ fromBlock: 0n });
    // At most 10% of the balance per call.
    assert.equal(ev!.args.quoteSpent, balBefore / 10n);
    assert.equal(await l.token.read.totalSupply(), supplyBefore - ev!.args.tokensBurned!);
    assert.equal(await l.token.read.balanceOf([l.treasury.address]), 0n);
  });

  it("TR-02 buyback cooldown is one hour and maxQuoteIn is respected", async () => {
    const f = await deployPortus();
    const l = await live(f);
    await l.treasury.write.startObservation();
    await churn(f, l);
    await advance(f, 30n * 60n);
    await l.treasury.write.executeBuyback([1000n, 0n]);
    const [ev] = await l.treasury.getEvents.Buyback({ fromBlock: 0n });
    assert.equal(ev!.args.quoteSpent, 1000n);
    await expectCustom(f.viem, l.treasury.write.executeBuyback([1000n, 0n]), l.treasury, "CooldownActive");
    await advance(f, 3600n);
    await l.treasury.write.executeBuyback([1000n, 0n]);
  });

  it("TR-03 a pump right before the buyback trips the TWAP price guard", async () => {
    const f = await deployPortus();
    const l = await live(f);
    await l.treasury.write.startObservation();
    await churn(f, l);
    await advance(f, 30n * 60n);
    // Pump the spot price ~25% in the last block.
    await f.fund(f.weth.address, f.c, l.pool.address, 3n * WAD);
    await l.pool.write.buy([3n * WAD, 1n, f.c.account.address, (await f.now()) + 600n], { account: f.c.account });
    await expectCustom(f.viem, l.treasury.write.executeBuyback([maxUint256, 0n]), l.pool, "SlippageExceeded");
  });

  it("TR-06 a stale observation can be refreshed after 4h, not before", async () => {
    const f = await deployPortus();
    const l = await live(f);
    await l.treasury.write.startObservation();
    const first = await l.treasury.read.obsTime();
    await advance(f, 3n * 3600n);
    await expectCustom(f.viem, l.treasury.write.startObservation({ account: f.outsider.account }), l.treasury, "AlreadyObserving");
    await advance(f, 3600n);
    await l.treasury.write.startObservation({ account: f.outsider.account });
    assert.ok((await l.treasury.read.obsTime()) > first);
  });

  it("TR-04 the observation cannot start before the pool is live", async () => {
    const f = await deployPortus();
    const l = await f.launch();
    await expectCustom(f.viem, l.treasury.write.startObservation(), l.treasury, "PoolNotLive");
  });

  it("TR-05 rewards mode hands the balance to the Distributor once per 24h", async () => {
    const f = await deployPortus();
    const l = await live(f, { treasuryMode: 1 });
    await expectCustom(f.viem, l.treasury.write.startObservation(), l.treasury, "WrongMode");
    await expectCustom(f.viem, l.treasury.write.executeBuyback([1n, 0n]), l.treasury, "WrongMode");
    await expectCustom(f.viem, l.treasury.write.fundRewards(), l.treasury, "NothingToSpend");
    await churn(f, l, 1);
    const bal = await f.weth.read.balanceOf([l.treasury.address]);
    await l.treasury.write.fundRewards({ account: f.outsider.account });
    assert.equal(await f.weth.read.balanceOf([l.treasury.address]), 0n);
    assert.equal(await f.distributor.read.funded([l.token.address, f.weth.address]), bal);
    assert.equal(await f.distributor.read.available([l.token.address, f.weth.address]), bal);
    await churn(f, l, 1);
    await expectCustom(f.viem, l.treasury.write.fundRewards(), l.treasury, "CooldownActive");
    await advance(f, 86_400n);
    await l.treasury.write.fundRewards();
  });
});
