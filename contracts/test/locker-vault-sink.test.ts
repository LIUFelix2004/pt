// Locker tests. (IncentiveVault and FeeSink were replaced by PortusDistributor
// and PortusFeeSplitter — see distributor.test.ts and fee-splitter.test.ts.)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deployPortus, expectCustom, subPublic, WAD } from "./helpers/fixture.js";

describe("PortusLocker", () => {
  it("accepts one notifyLocked per registered pool and holds the genesis shares", async () => {
    const f = await deployPortus();
    await expectCustom(f.viem, f.locker.write.notifyLocked([1n], { account: f.outsider.account }), f.locker, "UnknownPool");
    const l = await f.launch();
    await f.jumpTo(l.params.startTime);
    await subPublic(f, l, f.a, 10n * WAD);
    await f.jumpTo(l.params.startTime + l.params.duration);
    await l.sale.write.finalize();
    const locked = await f.locker.read.lockedShares([l.pool.address]);
    assert.ok(locked > 0n);
    assert.equal(await l.pool.read.lockedShares(), locked);
    assert.equal(await l.pool.read.sharesOf([f.locker.address]), locked);
  });
});
