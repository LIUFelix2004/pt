import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deployPortus, expectCustom, subPublic, WAD } from "./helpers/fixture.js";

describe("PortusSale claims and dust", () => {
  it("S-18 claim errors, and claimFor pays only the account", async () => {
    const f = await deployPortus();
    const l = await f.launch();
    await f.jumpTo(l.params.startTime);
    await subPublic(f, l, f.a, 6n * WAD);
    await subPublic(f, l, f.b, 6n * WAD);
    await expectCustom(f.viem, l.sale.write.claim({ account: f.a.account }), l.sale, "NotSettled");
    await f.jumpTo(l.params.startTime + l.params.duration);
    await expectCustom(f.viem, l.sale.write.claim({ account: f.a.account }), l.sale, "NotSettled");
    await l.sale.write.finalize();

    await expectCustom(f.viem, l.sale.write.claim({ account: f.outsider.account }), l.sale, "NothingToClaim");
    const [tok, ref] = await l.sale.read.previewClaim([f.a.account.address]);
    await l.sale.write.claimFor([f.a.account.address], { account: f.outsider.account });
    assert.equal(await l.token.read.balanceOf([f.a.account.address]), tok);
    assert.equal(await f.weth.read.balanceOf([f.a.account.address]), ref);
    assert.equal(await l.token.read.balanceOf([f.outsider.account.address]), 0n);
    assert.equal(await f.weth.read.balanceOf([f.outsider.account.address]), 0n);
    await expectCustom(f.viem, l.sale.write.claim({ account: f.a.account }), l.sale, "AlreadyClaimed");
    assert.deepEqual(await l.sale.read.previewClaim([f.a.account.address]), [0n, 0n]);

    const ev = await l.sale.getEvents.Claimed({}, { fromBlock: 0n });
    assert.equal(ev[0]!.args.caller!.toLowerCase(), f.outsider.account.address.toLowerCase());
    assert.equal(await l.sale.read.claimedCount(), 1n);
  });

  it("S-19 sweepDust waits for every claim, then burns and forwards exactly the dust", async () => {
    const f = await deployPortus();
    const l = await f.launch();
    await f.jumpTo(l.params.startTime);
    await subPublic(f, l, f.a, 7n * WAD + 3n);
    await subPublic(f, l, f.b, 8n * WAD - 3n);
    await subPublic(f, l, f.c, 10n * WAD);
    await f.jumpTo(l.params.startTime + l.params.duration);
    await l.sale.write.finalize();

    await l.sale.write.claim({ account: f.a.account });
    await expectCustom(f.viem, l.sale.write.sweepDust(), l.sale, "ClaimsOutstanding");
    await l.sale.write.claim({ account: f.b.account });
    await l.sale.write.claim({ account: f.c.account });

    const supplyBefore = await l.token.read.totalSupply();
    const tokenLeft = await l.token.read.balanceOf([l.sale.address]);
    const quoteLeft = await f.weth.read.balanceOf([l.sale.address]);
    await l.sale.write.sweepDust();
    assert.equal(await l.token.read.totalSupply(), supplyBefore - tokenLeft);
    assert.equal(await f.weth.read.balanceOf([l.treasury.address]), quoteLeft);
    assert.equal(quoteLeft, 1n);
    assert.equal(await l.sale.read.dustSwept(), true);
    await expectCustom(f.viem, l.sale.write.sweepDust(), l.sale, "AlreadySwept");
  });

  it("previewClaim before finalize projects the current outcome", async () => {
    const f = await deployPortus();
    const l = await f.launch();
    await f.jumpTo(l.params.startTime);
    await subPublic(f, l, f.a, 4n * WAD);
    // Below target under REFUND: projection is a full refund.
    assert.deepEqual(await l.sale.read.previewClaim([f.a.account.address]), [0n, 4n * WAD]);
    await subPublic(f, l, f.b, 16n * WAD);
    const [tok, ref] = await l.sale.read.previewClaim([f.a.account.address]);
    assert.equal(ref, 2n * WAD);
    assert.equal(tok, (await l.sale.read.qSale()) / 5n);
  });
});
