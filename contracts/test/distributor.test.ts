import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address } from "viem";
import { buildRewardTree, releasedIncentive } from "@portus/shared";
import { advance, deployPortus, expectCustom, subPublic, WAD, type Portus } from "./helpers/fixture.js";

const DAY = 86_400n;

async function live(f: Portus, over: Parameters<Portus["launch"]>[0] = {}) {
  const l = await f.launch(over);
  await f.jumpTo(l.params.startTime);
  await subPublic(f, l, f.a, l.params.raiseTarget);
  await f.jumpTo(l.params.startTime + l.params.duration);
  await l.sale.write.finalize();
  return l;
}

describe("PortusDistributor", () => {
  it("DI-01 linear release: r·S per whole day, capped at the pool", async () => {
    const f = await deployPortus();
    const l = await live(f, { incentiveBps: 3000, releaseRateBps: 30 });
    const total = 3n * 10n ** 26n;
    assert.equal((await f.distributor.read.launchOf([l.token.address]))[4], total);
    assert.equal(await l.token.read.balanceOf([f.distributor.address]), total);
    assert.equal(await f.distributor.read.released([l.token.address]), 0n);
    await advance(f, DAY);
    assert.equal(await f.distributor.read.released([l.token.address]), 3n * 10n ** 24n); // 0.3% of S
    await advance(f, 99n * DAY);
    assert.equal(await f.distributor.read.released([l.token.address]), total); // x/r = 100 days
    await advance(f, 50n * DAY);
    assert.equal(await f.distributor.read.released([l.token.address]), total);
  });

  it("DI-02 decaying release matches the shared calculator (half-life ≈ 230 days at 0.3%)", async () => {
    const f = await deployPortus();
    const l = await live(f, { incentiveBps: 3000, releaseRateBps: 30, releaseMode: 1 });
    const total = 3n * 10n ** 26n;
    for (const days of [1n, 7n, 230n]) {
      const start = (await f.distributor.read.launchOf([l.token.address]))[5];
      await f.jumpTo(start + days * DAY);
      const got = await f.distributor.read.released([l.token.address]);
      assert.equal(got, releasedIncentive(total, "DECAYING", 30, days));
    }
    const half = await f.distributor.read.released([l.token.address]);
    assert.ok(half > total / 2n - total / 100n && half < total / 2n + total / 100n, `230 days ≈ half: ${half}`);
  });

  it("DI-03 roots are bounded by what was released, claimable after 24h, once per account", async () => {
    const f = await deployPortus();
    const l = await live(f);
    const token = l.token.address as Address;
    const pub = { account: f.publisher.account };
    await advance(f, DAY);
    const avail = await f.distributor.read.available([token, token]);
    assert.equal(avail, 3n * 10n ** 24n);

    const tree = buildRewardTree(token, token, 0, [
      { account: f.b.account.address, amount: 2n * 10n ** 24n },
      { account: f.c.account.address, amount: 10n ** 24n },
    ]);
    await f.viem.assertions.revertWithCustomErrorWithArgs(
      f.distributor.write.publishRoot([token, token, tree.root, avail + 1n, "ipfs://x"], pub),
      f.distributor,
      "ExceedsAvailable",
      [avail, avail + 1n],
    );
    await expectCustom(f.viem, f.distributor.write.publishRoot([f.outsider.account.address, token, tree.root, 0n, ""], pub), f.distributor, "UnknownLaunch");
    await f.distributor.write.publishRoot([token, token, tree.root, tree.total, "ipfs://epoch-0"], pub);
    assert.equal(await f.distributor.read.available([token, token]), 0n);
    assert.equal(await f.distributor.read.epochCount([token, token]), 1n);

    const eb = tree.entries.find((e) => e.account.toLowerCase() === f.b.account.address.toLowerCase())!;
    await expectCustom(f.viem, f.distributor.write.claim([token, token, 0n, eb.amount, eb.proof], { account: f.b.account }), f.distributor, "NotClaimable");
    await advance(f, DAY);
    await expectCustom(f.viem, f.distributor.write.claim([token, token, 0n, eb.amount + 1n, eb.proof], { account: f.b.account }), f.distributor, "InvalidProof");
    await f.distributor.write.claim([token, token, 0n, eb.amount, eb.proof], { account: f.b.account });
    assert.equal(await l.token.read.balanceOf([f.b.account.address]), eb.amount);
    await expectCustom(f.viem, f.distributor.write.claim([token, token, 0n, eb.amount, eb.proof], { account: f.b.account }), f.distributor, "AlreadyClaimed");

    const ec = tree.entries.find((e) => e.account.toLowerCase() === f.c.account.address.toLowerCase())!;
    await f.distributor.write.claimFor([f.c.account.address, token, token, 0n, ec.amount, ec.proof], { account: f.outsider.account });
    assert.equal(await l.token.read.balanceOf([f.c.account.address]), ec.amount);
    assert.equal(await l.token.read.balanceOf([f.outsider.account.address]), 0n);
  });

  it("DI-04 a root listing more than its declared total can never overdraw the epoch", async () => {
    const f = await deployPortus();
    const l = await live(f);
    const token = l.token.address as Address;
    await advance(f, DAY);
    const tree = buildRewardTree(token, token, 0, [
      { account: f.b.account.address, amount: 2n * 10n ** 24n },
      { account: f.c.account.address, amount: 2n * 10n ** 24n },
    ]);
    // Declares 3e24 while the leaves sum to 4e24.
    await f.distributor.write.publishRoot([token, token, tree.root, 3n * 10n ** 24n, ""], { account: f.publisher.account });
    await advance(f, DAY);
    const [eb, ec] = tree.entries;
    await f.distributor.write.claim([token, token, 0n, eb!.amount, eb!.proof], { account: eb!.account });
    await expectCustom(
      f.viem,
      f.distributor.write.claim([token, token, 0n, ec!.amount, ec!.proof], { account: ec!.account }),
      f.distributor,
      "EpochOverdrawn",
    );
  });

  it("DI-05 treasury reward pot pays the quote asset by root", async () => {
    const f = await deployPortus();
    const l = await live(f, { treasuryMode: 1 });
    const token = l.token.address as Address;
    for (let i = 0; i < 2; i++) {
      await f.fund(f.weth.address, f.b, l.pool.address, 2n * WAD);
      await l.pool.write.buy([2n * WAD, 1n, f.b.account.address, (await f.now()) + 600n], { account: f.b.account });
    }
    await l.treasury.write.fundRewards();
    const pot = await f.distributor.read.available([token, f.weth.address]);
    assert.ok(pot > 0n);
    const tree = buildRewardTree(token, f.weth.address, 0, [{ account: f.a.account.address, amount: pot }]);
    await f.distributor.write.publishRoot([token, f.weth.address, tree.root, pot, ""], { account: f.publisher.account });
    await advance(f, DAY);
    const before = await f.weth.read.balanceOf([f.a.account.address]);
    await f.distributor.write.claim([token, f.weth.address, 0n, pot, tree.entries[0]!.proof], { account: f.a.account });
    assert.equal((await f.weth.read.balanceOf([f.a.account.address])) - before, pot);
  });

  it("DI-06 single-level referral: bind once, never yourself", async () => {
    const f = await deployPortus();
    const o = { account: f.a.account };
    await expectCustom(f.viem, f.distributor.write.bindReferrer([f.a.account.address], o), f.distributor, "InvalidReferrer");
    await expectCustom(f.viem, f.distributor.write.bindReferrer(["0x0000000000000000000000000000000000000000"], o), f.distributor, "InvalidReferrer");
    await f.distributor.write.bindReferrer([f.b.account.address], o);
    assert.equal((await f.distributor.read.referrerOf([f.a.account.address])).toLowerCase(), f.b.account.address.toLowerCase());
    await expectCustom(f.viem, f.distributor.write.bindReferrer([f.c.account.address], o), f.distributor, "ReferrerAlreadySet");
  });

  it("DI-07 incentives are funded once, by the sale only", async () => {
    const f = await deployPortus();
    const l = await live(f);
    await f.provider.request({ method: "hardhat_impersonateAccount", params: [l.sale.address] });
    await f.provider.request({ method: "hardhat_setBalance", params: [l.sale.address, "0xde0b6b3a7640000"] });
    await expectCustom(f.viem, f.distributor.write.notifyIncentive([1n], { account: l.sale.address }), f.distributor, "AlreadyFunded");
    const l2 = await f.launch();
    await f.provider.request({ method: "hardhat_impersonateAccount", params: [l2.sale.address] });
    await f.provider.request({ method: "hardhat_setBalance", params: [l2.sale.address, "0xde0b6b3a7640000"] });
    await expectCustom(f.viem, f.distributor.write.notifyIncentive([1n], { account: l2.sale.address }), f.distributor, "FundingMismatch");
  });
});
