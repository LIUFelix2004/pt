import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maxUint128, zeroAddress } from "viem";
import { advance, deployPortus, expectCustom, subPublic, WAD, type LaunchHandle, type Portus } from "./helpers/fixture.js";

const DAY = 86_400n;

/** n live launches with increasing raise targets (so increasing market caps). */
async function livePools(f: Portus, n: number) {
  const ls: LaunchHandle[] = [];
  for (let i = 0; i < n; i++) ls.push(await f.launch({ raiseTarget: BigInt(i + 1) * WAD, publicCap: 10n ** 30n }));
  await f.jumpTo(ls[ls.length - 1]!.params.startTime);
  for (const l of ls) await subPublic(f, l, f.a, l.params.raiseTarget);
  await f.jumpTo(ls[ls.length - 1]!.params.startTime + ls[0]!.params.duration);
  for (const l of ls) await l.sale.write.finalize();
  return ls;
}

/** Trade on every pool (fees accrue to the flywheel) and checkpoint daily for `days` days. */
async function history(f: Portus, ls: LaunchHandle[], days: number) {
  for (let d = 0; d < days; d++) {
    for (const l of ls) {
      await f.flywheel.write.checkpoint([l.pool.address]);
      await f.fund(f.weth.address, f.b, l.pool.address, WAD / 10n);
      await l.pool.write.buy([WAD / 10n, 1n, f.b.account.address, (await f.now()) + 600n], { account: f.b.account });
    }
    await advance(f, DAY);
  }
}

describe("PortusFlywheel", () => {
  it("FW-01 checkpoints: registered pools only, at most once a day", async () => {
    const f = await deployPortus();
    const [l] = await livePools(f, 1);
    await expectCustom(f.viem, f.flywheel.write.checkpoint([f.outsider.account.address]), f.flywheel, "UnknownPool");
    await f.flywheel.write.checkpoint([l!.pool.address]);
    await expectCustom(f.viem, f.flywheel.write.checkpoint([l!.pool.address]), f.flywheel, "CheckpointTooSoon");
    await advance(f, DAY);
    await f.flywheel.write.checkpoint([l!.pool.address]);
    assert.equal(await f.flywheel.read.checkpointCount([l!.pool.address]), 2n);
  });

  it("FW-02 eligibility needs 7 days of history and the minimum liquidity", async () => {
    const f = await deployPortus();
    const [l] = await livePools(f, 1);
    // 6 daily checkpoints: the oldest is ~6 days old — not yet eligible.
    await history(f, [l!], 6);
    assert.equal((await f.flywheel.read.twapMarketCap([l!.pool.address]))[0], false);
    await history(f, [l!], 1);
    const [ok, cap] = await f.flywheel.read.twapMarketCap([l!.pool.address]);
    assert.equal(ok, true);
    assert.ok(cap > 0n);
    // Raise the threshold above the pool's quote reserve: no longer eligible.
    await f.factory.write.setQuoteAsset([f.weth.address, true, false, 1n, maxUint128, zeroAddress, 100n * WAD]);
    assert.equal((await f.flywheel.read.twapMarketCap([l!.pool.address]))[0], false);
  });

  it("FW-03 nominations keep the 10 highest 7-day market caps", async () => {
    const f = await deployPortus();
    const ls = await livePools(f, 11);
    await history(f, ls, 8);
    await f.flywheel.write.startRound([f.weth.address]);
    await expectCustom(f.viem, f.flywheel.write.startRound([f.weth.address]), f.flywheel, "RoundActive");
    for (const l of ls.slice(0, 10)) await f.flywheel.write.nominate([f.weth.address, l.pool.address], { account: f.outsider.account });
    await expectCustom(f.viem, f.flywheel.write.nominate([f.weth.address, ls[3]!.pool.address]), f.flywheel, "AlreadyNominated");
    // The 11th has the largest raise, hence the largest cap: it evicts the smallest (index 0).
    await f.flywheel.write.nominate([f.weth.address, ls[10]!.pool.address]);
    const [pools] = await f.flywheel.read.rankedPools([f.weth.address]);
    const set = new Set(pools.map((p) => p.toLowerCase()));
    assert.equal(set.size, 10);
    assert.equal(set.has(ls[0]!.pool.address.toLowerCase()), false);
    assert.equal(set.has(ls[10]!.pool.address.toLowerCase()), true);
    // The evicted pool cannot come back: its cap is below the current minimum.
    await expectCustom(f.viem, f.flywheel.write.nominate([f.weth.address, ls[0]!.pool.address]), f.flywheel, "NotRanked");
  });

  it("FW-04 execute: pulls the 20% share, buys each ranked pool (≤ 1% of reserve) and burns", async () => {
    const f = await deployPortus();
    const ls = await livePools(f, 2);
    await history(f, ls, 8);
    await f.flywheel.write.startRound([f.weth.address]);
    for (const l of ls) await f.flywheel.write.nominate([f.weth.address, l.pool.address]);
    await expectCustom(f.viem, f.flywheel.write.executeRound([f.weth.address]), f.flywheel, "NominationOpen");
    await advance(f, 12n * 3600n);
    await expectCustom(f.viem, f.flywheel.write.nominate([f.weth.address, ls[0]!.pool.address]), f.flywheel, "NominationClosed");

    const owed = await f.splitter.read.owed([f.weth.address, f.flywheel.address]);
    assert.ok(owed > 0n);
    const supplies = await Promise.all(ls.map((l) => l.token.read.totalSupply()));
    const hash = await f.flywheel.write.executeRound([f.weth.address], { account: f.outsider.account });
    const block = (await f.publicClient.waitForTransactionReceipt({ hash })).blockNumber;
    // The old balance was pulled; what is owed now is exactly 20% of the fees
    // the flywheel's own buybacks just paid.
    const splits = await f.splitter.getEvents.FeeSplit({}, { fromBlock: block, toBlock: block });
    const back = splits.reduce((s, e) => s + e.args.flywheel!, 0n);
    assert.ok(back > 0n);
    assert.equal(await f.splitter.read.owed([f.weth.address, f.flywheel.address]), back);
    const buys = await f.flywheel.getEvents.FlywheelBuyback({}, { fromBlock: 0n });
    const skipped = await f.flywheel.getEvents.BuybackSkipped({}, { fromBlock: 0n });
    assert.equal(buys.length, 2, JSON.stringify(skipped.map((s) => s.args), (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    for (let i = 0; i < ls.length; i++) {
      const ev = buys.find((b) => b.args.pool!.toLowerCase() === ls[i]!.pool.address.toLowerCase())!;
      assert.equal(await ls[i]!.token.read.totalSupply(), supplies[i]! - ev.args.tokensBurned!);
      assert.ok(ev.args.quoteSpent! <= owed / 2n);
    }
    assert.equal(await ls[0]!.token.read.balanceOf([f.flywheel.address]), 0n);
    await expectCustom(f.viem, f.flywheel.write.executeRound([f.weth.address]), f.flywheel, "NoActiveRound");
    await expectCustom(f.viem, f.flywheel.write.startRound([f.weth.address]), f.flywheel, "RoundActive");
    await advance(f, DAY);
    await f.flywheel.write.startRound([f.weth.address]);
  });

  it("FW-05 a pumped pool fails the price guard and is skipped, not bought", async () => {
    const f = await deployPortus();
    const ls = await livePools(f, 1);
    await history(f, ls, 8);
    await f.flywheel.write.startRound([f.weth.address]);
    await f.flywheel.write.nominate([f.weth.address, ls[0]!.pool.address]);
    await advance(f, 12n * 3600n);
    await f.fund(f.weth.address, f.c, ls[0]!.pool.address, 5n * WAD);
    await ls[0]!.pool.write.buy([5n * WAD, 1n, f.c.account.address, (await f.now()) + 600n], { account: f.c.account });
    await f.flywheel.write.executeRound([f.weth.address]);
    assert.equal((await f.flywheel.getEvents.FlywheelBuyback({}, { fromBlock: 0n })).length, 0);
    assert.equal((await f.flywheel.getEvents.BuybackSkipped({}, { fromBlock: 0n })).length, 1);
    assert.ok((await f.weth.read.balanceOf([f.flywheel.address])) > 0n); // kept for the next round
  });

  it("FW-06 nominations must match the round's quote asset", async () => {
    const f = await deployPortus();
    const [l] = await livePools(f, 1);
    const usd = await f.viem.deployContract("MockERC20", ["USD", "USD", 6]);
    await expectCustom(f.viem, f.flywheel.write.nominate([usd.address, l!.pool.address]), f.flywheel, "NoActiveRound");
    await f.flywheel.write.startRound([usd.address]);
    await expectCustom(f.viem, f.flywheel.write.nominate([usd.address, l!.pool.address]), f.flywheel, "UnknownPool");
    await f.flywheel.write.startRound([f.weth.address]);
    await expectCustom(f.viem, f.flywheel.write.nominate([f.weth.address, l!.pool.address]), f.flywheel, "NotEligible");
  });
});
