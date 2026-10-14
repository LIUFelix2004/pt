import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maxUint128, zeroAddress, zeroHash } from "viem";
import { previewPrice } from "@portus/shared";
import { deployPortus, expectCustom, DAY, HOUR, Rule, S, WAD } from "./helpers/fixture.js";

describe("PortusFactory", () => {
  it("F-01 creates token, sale and pool in one tx and hands the sale the full supply", async () => {
    const f = await deployPortus();
    const l = await f.launch();
    assert.equal(await l.token.read.totalSupply(), S);
    assert.equal(await l.token.read.balanceOf([l.sale.address]), S);
    assert.equal(await l.token.read.balanceOf([f.factory.address]), 0n);
    assert.equal(await f.factory.read.launchCount(), 1n);
    assert.equal(await f.factory.read.launchIdOf([l.token.address]), 1n);
    assert.equal(await f.factory.read.isSale([l.sale.address]), true);
    assert.equal(await f.factory.read.isPool([l.pool.address]), true);
    assert.equal((await f.factory.read.launchOf([l.token.address])).sale.toLowerCase(), l.sale.address.toLowerCase());
    assert.equal(l.info.creator.toLowerCase(), f.creator.account.address.toLowerCase());

    const [qSale, qLp, qInc, r, s] = await f.factory.read.previewPrice([l.params.raiseTarget, 3000]);
    const ts = previewPrice(l.params.raiseTarget, 3000);
    assert.deepEqual([qSale, qLp, qInc, r, s], [ts.qSale, ts.qLp, ts.qInc, ts.r, ts.s]);
    assert.equal(await l.sale.read.priceNum(), r);
    assert.equal(await l.sale.read.priceDen(), s);
    assert.equal(await l.sale.read.qSale(), qSale);
    assert.equal(await l.sale.read.creator(), l.info.creator);

    const events = await f.factory.getEvents.LaunchCreated();
    assert.equal(events.length, 1);
    assert.equal(events[0]!.args.qSale, qSale);
    assert.equal(events[0]!.args.priceNum, r);
    const rules = await f.factory.getEvents.LaunchRules();
    assert.equal(rules[0]!.args.endTime, l.params.startTime + l.params.duration);
    assert.equal(rules[0]!.args.feeBps, 100);
  });

  it("F-02 rejects every out-of-bounds parameter", async () => {
    const f = await deployPortus();
    const t = await f.now();
    const bad = async (over: Parameters<typeof f.defaults>[0], error: string) => {
      const p = await f.defaults(over);
      await expectCustom(f.viem, f.factory.write.createLaunch([p]), f.factory, error);
    };
    await bad({ feeBps: 150 }, "InvalidFeeTier");
    await bad({ feeBps: 0 }, "InvalidFeeTier");
    await bad({ feeBps: 600 }, "InvalidFeeTier");
    await bad({ creatorShareBps: 4001 }, "CreatorShareTooHigh");
    await bad({ incentiveBps: 3001 }, "IncentiveTooHigh");
    await bad({ raiseTarget: 0n }, "InvalidRaiseTarget");
    await bad({ raiseTarget: 2n ** 112n }, "InvalidRaiseTarget");
    await bad({ raiseTarget: 10n * WAD + 1n }, "PriceNotGranular");
    await bad({ startTime: t - 1n }, "InvalidSchedule");
    await bad({ startTime: t + 31n * DAY }, "InvalidSchedule");
    await bad({ duration: HOUR - 1n }, "InvalidSchedule");
    await bad({ duration: 14n * DAY + 1n }, "InvalidSchedule");
    await bad({ merkleRoot: zeroHash, publicOpenAt: 0n, publicCap: 0n }, "NoSubscriptionPath");
    await bad({ merkleRoot: zeroHash, publicOpenAt: t + 100n }, "NoSubscriptionPath");
    const root = `0x${"11".repeat(32)}` as const;
    await bad({ merkleRoot: root, startTime: t + 60n, publicOpenAt: t + 60n + HOUR }, "InvalidPublicPhase");
    await bad({ merkleRoot: root, startTime: t + 60n, publicOpenAt: t + 59n }, "InvalidPublicPhase");
    await bad({ merkleRoot: root, publicOpenAt: t + 60n, startTime: t + 60n, publicCap: 0n }, "InvalidPublicPhase");
    await bad({ merkleRoot: root, publicOpenAt: 0n, publicCap: 1n }, "InvalidPublicPhase");
    await bad({ underRule: Rule.REFUND, minFillBps: 1 }, "InvalidUnderfill");
    await bad({ underRule: Rule.SHRINK, minFillBps: 10_001 }, "InvalidUnderfill");
    await bad({ name: "" }, "InvalidMetadata");
    await bad({ name: "x".repeat(33) }, "InvalidMetadata");
    await bad({ symbol: "" }, "InvalidMetadata");
    await bad({ symbol: "ABCDEFGHIJKL" }, "InvalidMetadata");

    // FDV bounds on both sides: R = 10e18, X = 30% -> FDV = R·S/qSale ≈ 28.57e18.
    await f.factory.write.setQuoteAsset([f.weth.address, true, false, 29n * WAD, maxUint128, zeroAddress, 0n]);
    await bad({}, "FdvOutOfBounds");
    await f.factory.write.setQuoteAsset([f.weth.address, true, false, 1n, 28n * WAD, zeroAddress, 0n]);
    await bad({}, "FdvOutOfBounds");
  });

  it("F-03 accepts parameters exactly on the boundary", async () => {
    const f = await deployPortus();
    const t = await f.now();
    await f.launch({ feeBps: 100 });
    await f.launch({ feeBps: 500 });
    await f.launch({ creatorShareBps: 4000 });
    await f.launch({ incentiveBps: 0 });
    await f.launch({ incentiveBps: 3000 });
    await f.launch({ duration: HOUR });
    await f.launch({ duration: 14n * DAY });
    await f.launch({ startTime: t + 30n * DAY, publicOpenAt: t + 30n * DAY });
    // startTime == block.timestamp of the creating tx (automine: +1s)
    const t2 = await f.now();
    await f.launch({ startTime: t2 + 1n, publicOpenAt: t2 + 1n });
    await f.launch({ underRule: Rule.SHRINK, minFillBps: 10_000 });
    await f.launch({ name: "x".repeat(32), symbol: "ABCDEFGHIJK" });
    // The smallest granular raise: r = 1 with g = 1e6.
    await f.launch({ raiseTarget: 10n ** 6n });
    assert.equal(await f.factory.read.launchCount(), 12n);
  });

  it("F-04 only allowed quote assets; disabling one leaves existing launches untouched", async () => {
    const f = await deployPortus();
    const usd = await f.viem.deployContract("MockERC20", ["USD", "USD", 6]);
    const p = await f.defaults({ quoteAsset: usd.address });
    await expectCustom(f.viem, f.factory.write.createLaunch([p]), f.factory, "QuoteAssetNotAllowed");
    await expectCustom(
      f.viem,
      f.factory.write.setQuoteAsset([usd.address, true, true, 1n, maxUint128, zeroAddress, 0n], { account: f.outsider.account }),
      f.factory,
      "NotQuoteAdmin",
    );

    const l = await f.launch();
    await f.factory.write.setQuoteAsset([f.weth.address, false, false, 1n, maxUint128, zeroAddress, 0n]);
    await expectCustom(f.viem, f.factory.write.createLaunch([await f.defaults()]), f.factory, "QuoteAssetNotAllowed");

    // The existing launch still subscribes, settles and trades.
    await f.jumpTo(l.params.startTime);
    await f.fund(f.weth.address, f.a, l.sale.address, 10n * WAD);
    await l.sale.write.subscribePublic([10n * WAD], { account: f.a.account });
    await f.jumpTo(l.params.startTime + l.params.duration);
    await l.sale.write.finalize();
    assert.equal(await l.pool.read.initialized(), true);
    await f.fund(f.weth.address, f.b, l.pool.address, WAD);
    await l.pool.write.buy([WAD, 1n, f.b.account.address, (await f.now()) + 100n], { account: f.b.account });
  });

  it("F-05 pins decimals on first registration and validates bounds", async () => {
    const f = await deployPortus();
    const usd = await f.viem.deployContract("MockERC20", ["USD", "USD", 6]);
    await f.factory.write.setQuoteAsset([usd.address, true, true, 5n, 10n, zeroAddress, 0n]);
    let cfg = await f.factory.read.quoteAssets([usd.address]);
    assert.equal(cfg[3], 6); // decimals
    assert.equal(cfg[2], true); // freezable
    await f.factory.write.setQuoteAsset([usd.address, false, false, 1n, 2n, zeroAddress, 0n]);
    cfg = await f.factory.read.quoteAssets([usd.address]);
    assert.equal(cfg[3], 6);
    assert.equal(cfg[1], false);

    const wide = await f.viem.deployContract("MockERC20", ["Wide", "W", 19]);
    await expectCustom(f.viem, f.factory.write.setQuoteAsset([wide.address, true, false, 1n, 2n, zeroAddress, 0n]), f.factory, "UnsupportedDecimals");
    await expectCustom(f.viem, f.factory.write.setQuoteAsset([usd.address, true, false, 3n, 2n, zeroAddress, 0n]), f.factory, "InvalidFdvBounds");
    await expectCustom(f.viem, f.factory.write.setQuoteAsset([zeroAddress, true, false, 1n, 2n, zeroAddress, 0n]), f.factory, "ZeroAddress");
    for (const args of [
      [zeroAddress, f.ecosystem.account.address, f.publisher.account.address],
      [f.admin.account.address, zeroAddress, f.publisher.account.address],
      [f.admin.account.address, f.ecosystem.account.address, zeroAddress],
    ] as const) {
      await assert.rejects(f.viem.deployContract("PortusFactory", [...args], { libraries: f.libraries }), /ZeroAddress/);
    }
  });

  it("F-06 locker, splitter, distributor and flywheel belong to this factory and register each launch", async () => {
    const f = await deployPortus();
    const l = await f.launch({ creatorShareBps: 2500, creatorRecipient: f.d.account.address });
    const fa = f.factory.address.toLowerCase();
    for (const c of [f.locker, f.splitter, f.distributor, f.flywheel]) {
      assert.equal((await c.read.factory()).toLowerCase(), fa);
    }
    assert.equal((await f.splitter.read.flywheel()).toLowerCase(), f.flywheel.address.toLowerCase());
    assert.equal((await f.splitter.read.ecosystem()).toLowerCase(), f.ecosystem.account.address.toLowerCase());
    assert.equal((await f.distributor.read.rootPublisher()).toLowerCase(), f.publisher.account.address.toLowerCase());
    assert.equal((await f.locker.read.tokenOfPool([l.pool.address])).toLowerCase(), l.token.address.toLowerCase());
    const reg = await f.splitter.read.sharesOfPool([l.pool.address]);
    assert.equal(reg[2].toLowerCase(), f.d.account.address.toLowerCase()); // creator recipient
    assert.equal(reg[3].toLowerCase(), l.treasury.address.toLowerCase());
    assert.deepEqual(await f.splitter.read.shares([l.token.address]), [2000, 2000, 2500, 3500]);
    assert.equal((await f.distributor.read.launchOf([l.token.address]))[0].toLowerCase(), l.sale.address.toLowerCase());
    assert.equal((await l.treasury.read.pool()).toLowerCase(), l.pool.address.toLowerCase());
    assert.equal((await f.factory.read.launchAt([l.id])).treasury.toLowerCase(), l.treasury.address.toLowerCase());

    const o = { account: f.outsider.account };
    const x = f.outsider.account.address;
    await expectCustom(f.viem, f.locker.write.registerPool([x, l.token.address], o), f.locker, "NotFactory");
    await expectCustom(f.viem, f.splitter.write.registerPool([x, x, x, x, 0, x], o), f.splitter, "NotFactory");
    await expectCustom(f.viem, f.distributor.write.registerLaunch([x, x, x, 0, 0], o), f.distributor, "NotFactory");
  });

  it("F-08 treasury mode and release parameters are bounded", async () => {
    const f = await deployPortus();
    const bad = async (over: Parameters<typeof f.defaults>[0], error: string) => {
      const p = await f.defaults(over);
      await expectCustom(f.viem, f.factory.write.createLaunch([p]), f.factory, error);
    };
    await bad({ treasuryMode: 2 }, "InvalidTreasuryMode");
    await bad({ releaseMode: 2 }, "InvalidRelease");
    await bad({ releaseRateBps: 9 }, "InvalidRelease");
    await bad({ releaseRateBps: 101 }, "InvalidRelease");
    await bad({ incentiveBps: 0, releaseRateBps: 30 }, "InvalidRelease");
    await f.launch({ releaseRateBps: 10 });
    await f.launch({ releaseRateBps: 100, releaseMode: 1, treasuryMode: 1 });
    await f.launch({ incentiveBps: 0, releaseRateBps: 0 });
    const ev = await f.factory.getEvents.LaunchEconomics({}, { fromBlock: 0n });
    assert.equal(ev.length, 3);
    assert.equal(ev[1]!.args.treasuryMode, 1);
    assert.equal(ev[1]!.args.releaseMode, 1);
    assert.equal(ev[0]!.args.creatorRecipient!.toLowerCase(), f.creator.account.address.toLowerCase());
  });

  it("F-07 bindSale is factory-only and one-shot", async () => {
    const f = await deployPortus();
    const l = await f.launch();
    assert.equal((await l.pool.read.sale()).toLowerCase(), l.sale.address.toLowerCase());
    await expectCustom(f.viem, l.pool.write.bindSale([f.outsider.account.address], { account: f.outsider.account }), l.pool, "NotFactory");
  });
});
