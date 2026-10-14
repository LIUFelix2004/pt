import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitFee } from "@portus/shared";
import { deployPortus, expectCustom, subPublic, WAD, type Portus } from "./helpers/fixture.js";

async function live(f: Portus, over: Parameters<Portus["launch"]>[0] = {}) {
  const l = await f.launch(over);
  await f.jumpTo(l.params.startTime);
  await subPublic(f, l, f.a, l.params.raiseTarget);
  await f.jumpTo(l.params.startTime + l.params.duration);
  await l.sale.write.finalize();
  return l;
}

const deadline = async (f: Portus) => (await f.now()) + 3600n;

describe("PortusFeeSplitter", () => {
  it("FS-01 splits every fee 20 / 20 / c / rest and pushes the treasury share", async () => {
    const f = await deployPortus();
    const l = await live(f, { feeBps: 300, creatorShareBps: 2500, creatorRecipient: f.d.account.address });
    const spend = 3n * WAD + 7n;
    await f.fund(f.weth.address, f.b, l.pool.address, spend);
    await l.pool.write.buy([spend, 1n, f.b.account.address, await deadline(f)], { account: f.b.account });
    const [ev] = await f.splitter.getEvents.FeeSplit({}, { fromBlock: 0n });
    const fee = ev!.args.ecosystem! + ev!.args.flywheel! + ev!.args.creator! + ev!.args.treasury!;
    const exp = splitFee(fee, 2500);
    assert.deepEqual(
      [ev!.args.ecosystem, ev!.args.flywheel, ev!.args.creator, ev!.args.treasury],
      [exp.ecosystem, exp.flywheel, exp.creator, exp.treasury],
    );
    assert.equal(await f.weth.read.balanceOf([l.treasury.address]), exp.treasury);
    assert.equal(await f.splitter.read.owed([f.weth.address, f.ecosystem.account.address]), exp.ecosystem);
    assert.equal(await f.splitter.read.owed([f.weth.address, f.flywheel.address]), exp.flywheel);
    assert.equal(await f.splitter.read.owed([f.weth.address, f.d.account.address]), exp.creator);
    assert.equal(await f.splitter.read.accounted([f.weth.address]), exp.ecosystem + exp.flywheel + exp.creator);
  });

  it("FS-02 recipients pull their own share; claimFor pays only the account", async () => {
    const f = await deployPortus();
    const l = await live(f, { creatorShareBps: 4000 });
    await f.fund(f.weth.address, f.b, l.pool.address, WAD);
    await l.pool.write.buy([WAD, 1n, f.b.account.address, await deadline(f)], { account: f.b.account });
    const owed = await f.splitter.read.owed([f.weth.address, f.creator.account.address]);
    assert.ok(owed > 0n);
    await f.splitter.write.claimFor([f.creator.account.address, f.weth.address], { account: f.outsider.account });
    assert.equal(await f.weth.read.balanceOf([f.creator.account.address]), owed);
    assert.equal(await f.weth.read.balanceOf([f.outsider.account.address]), 0n);
    await expectCustom(f.viem, f.splitter.write.claim([f.weth.address], { account: f.creator.account }), f.splitter, "NothingToClaim");
    const eco = await f.splitter.read.owed([f.weth.address, f.ecosystem.account.address]);
    await f.splitter.write.claim([f.weth.address], { account: f.ecosystem.account });
    assert.equal(await f.weth.read.balanceOf([f.ecosystem.account.address]), eco);
    assert.equal(
      await f.splitter.read.accounted([f.weth.address]),
      await f.splitter.read.owed([f.weth.address, f.flywheel.address]),
    );
  });

  it("FS-03 creator share 0 sends 60% to the treasury; shares() reports the locked ratios", async () => {
    const f = await deployPortus();
    const l = await live(f, { creatorShareBps: 0 });
    assert.deepEqual(await f.splitter.read.shares([l.token.address]), [2000, 2000, 0, 6000]);
    await f.fund(f.weth.address, f.b, l.pool.address, WAD);
    await l.pool.write.buy([WAD, 1n, f.b.account.address, await deadline(f)], { account: f.b.account });
    const fee = WAD / 100n;
    assert.equal(await f.weth.read.balanceOf([l.treasury.address]), fee - (fee * 4n) / 10n);
    assert.deepEqual(await f.splitter.read.shares([f.outsider.account.address]), [0, 0, 0, 0]);
  });

  it("FS-04 onFee rejects unknown callers and unfunded amounts", async () => {
    const f = await deployPortus();
    const l = await live(f);
    await expectCustom(f.viem, f.splitter.write.onFee([1n], { account: f.outsider.account }), f.splitter, "UnknownPool");
    await f.provider.request({ method: "hardhat_impersonateAccount", params: [l.pool.address] });
    await f.provider.request({ method: "hardhat_setBalance", params: [l.pool.address, "0xde0b6b3a7640000"] });
    await expectCustom(f.viem, f.splitter.write.onFee([5n], { account: l.pool.address }), f.splitter, "FeeNotReceived");
    await f.splitter.write.onFee([0n], { account: l.pool.address }); // no-op
  });
});
