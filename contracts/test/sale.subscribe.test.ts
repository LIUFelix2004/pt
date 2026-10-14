import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maxUint128, zeroHash, zeroAddress } from "viem";
import { deployPortus, expectCustom, subPublic, subWhitelist, Phase, WAD, HOUR } from "./helpers/fixture.js";

describe("PortusSale subscription", () => {
  it("S-01 rejects subscriptions before start and after end", async () => {
    const f = await deployPortus();
    const l = await f.launch();
    assert.equal(await l.sale.read.phase(), Phase.PENDING);
    await f.fund(f.weth.address, f.a, l.sale.address, WAD);
    await expectCustom(f.viem, l.sale.write.subscribePublic([WAD], { account: f.a.account }), l.sale, "NotOpen");
    await f.jumpTo(l.params.startTime);
    assert.equal(await l.sale.read.phase(), Phase.OPEN);
    await f.jumpTo(l.params.startTime + l.params.duration);
    assert.equal(await l.sale.read.phase(), Phase.AWAITING_FINALIZE);
    await expectCustom(f.viem, l.sale.write.subscribePublic([WAD], { account: f.a.account }), l.sale, "NotOpen");
  });

  it("S-02 whitelist proofs: valid passes, tampered or borrowed fails, caps are exact", async () => {
    const f = await deployPortus();
    const caps = { a: 5n * WAD, b: 3n * WAD };
    const l = await f.launch({}, [
      { account: f.a.account.address, cap: caps.a },
      { account: f.b.account.address, cap: caps.b },
      { account: f.c.account.address, cap: WAD },
    ]);
    await f.jumpTo(l.params.startTime);
    const ea = l.tree!.entries.get(f.a.account.address.toLowerCase())!;

    await f.fund(f.weth.address, f.a, l.sale.address, 10n * WAD);
    // wrong cap
    await expectCustom(f.viem, l.sale.write.subscribe([WAD, caps.a + 1n, ea.proof], { account: f.a.account }), l.sale, "InvalidProof");
    // someone else's proof
    await f.fund(f.weth.address, f.d, l.sale.address, WAD);
    await expectCustom(f.viem, l.sale.write.subscribe([WAD, caps.a, ea.proof], { account: f.d.account }), l.sale, "InvalidProof");
    // tampered proof
    const tampered = [...ea.proof];
    tampered[0] = zeroHash;
    await expectCustom(f.viem, l.sale.write.subscribe([WAD, caps.a, tampered], { account: f.a.account }), l.sale, "InvalidProof");

    // accumulate to the cap exactly, then 1 wei more fails
    await l.sale.write.subscribe([2n * WAD, caps.a, ea.proof], { account: f.a.account });
    await l.sale.write.subscribe([3n * WAD, caps.a, ea.proof], { account: f.a.account });
    assert.equal(await l.sale.read.whitelistCommitted([f.a.account.address]), caps.a);
    await f.viem.assertions.revertWithCustomErrorWithArgs(
      l.sale.write.subscribe([1n, caps.a, ea.proof], { account: f.a.account }),
      l.sale,
      "CapExceeded",
      [caps.a, caps.a + 1n],
    );
    await subWhitelist(f, l, f.b, caps.b);
    assert.equal(await l.sale.read.totalCommitted(), caps.a + caps.b);
  });

  it("S-03 public phase opens at publicOpenAt with its own per-address cap", async () => {
    const f = await deployPortus();
    const t = await f.now();
    const start = t + 60n;
    const l = await f.launch(
      { startTime: start, publicOpenAt: start + HOUR / 2n, publicCap: 2n * WAD },
      [{ account: f.a.account.address, cap: WAD }],
    );
    await f.jumpTo(start);
    await f.fund(f.weth.address, f.a, l.sale.address, 10n * WAD);
    await expectCustom(f.viem, l.sale.write.subscribePublic([WAD], { account: f.a.account }), l.sale, "PublicNotOpen");
    await subWhitelist(f, l, f.a, WAD);
    await f.jumpTo(start + HOUR / 2n);
    await f.fund(f.weth.address, f.a, l.sale.address, 10n * WAD);
    await l.sale.write.subscribePublic([2n * WAD], { account: f.a.account });
    await expectCustom(f.viem, l.sale.write.subscribePublic([1n], { account: f.a.account }), l.sale, "CapExceeded");
    assert.equal(await l.sale.read.whitelistCommitted([f.a.account.address]), WAD);
    assert.equal(await l.sale.read.publicCommitted([f.a.account.address]), 2n * WAD);
    assert.equal(await l.sale.read.committed([f.a.account.address]), 3n * WAD);
  });

  it("S-04 without a whitelist, subscribe always fails and the public path is open from the start", async () => {
    const f = await deployPortus();
    const l = await f.launch();
    await f.jumpTo(l.params.startTime);
    await f.fund(f.weth.address, f.a, l.sale.address, WAD);
    await expectCustom(f.viem, l.sale.write.subscribe([WAD, WAD, []], { account: f.a.account }), l.sale, "InvalidProof");
    await l.sale.write.subscribePublic([WAD], { account: f.a.account });
    await expectCustom(f.viem, l.sale.write.subscribePublic([0n], { account: f.a.account }), l.sale, "ZeroAmount");
  });

  it("S-05 rejects fee-on-transfer and rebasing quote assets by balance difference", async () => {
    const f = await deployPortus();
    for (const name of ["MockFeeOnTransferERC20", "MockRebasingERC20"] as const) {
      const q = await f.viem.deployContract(name);
      if (name === "MockRebasingERC20") await (q as any).write.setBonusBps([100n]);
      await f.factory.write.setQuoteAsset([q.address, true, false, 1n, maxUint128, zeroAddress, 0n]);
      const l = await f.launch({ quoteAsset: q.address });
      await f.jumpTo(l.params.startTime);
      const erc = await f.viem.getContractAt("MockERC20", q.address);
      await erc.write.mint([f.a.account.address, WAD]);
      await erc.write.approve([l.sale.address, WAD], { account: f.a.account });
      await expectCustom(f.viem, l.sale.write.subscribePublic([WAD], { account: f.a.account }), l.sale, "UnsupportedQuoteToken");
    }
  });

  it("S-06 counts each subscriber once and emits running totals", async () => {
    const f = await deployPortus();
    const l = await f.launch();
    await f.jumpTo(l.params.startTime);
    await subPublic(f, l, f.a, WAD);
    await subPublic(f, l, f.a, 2n * WAD);
    await subPublic(f, l, f.b, WAD);
    assert.equal(await l.sale.read.subscriberCount(), 2n);
    const events = await l.sale.getEvents.Subscribed({}, { fromBlock: 0n });
    assert.equal(events.length, 3);
    assert.equal(events[1]!.args.totalForAccount, 3n * WAD);
    assert.equal(events[2]!.args.totalCommitted, 4n * WAD);
    assert.equal(events[2]!.args.viaWhitelist, false);
  });
});
