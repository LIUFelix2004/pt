import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deployPortus, expectCustom, subPublic, WAD, type Portus } from "./helpers/fixture.js";

async function live(f: Portus) {
  const l = await f.launch();
  await f.jumpTo(l.params.startTime);
  await subPublic(f, l, f.a, l.params.raiseTarget);
  await f.jumpTo(l.params.startTime + l.params.duration);
  await l.sale.write.finalize();
  await l.sale.write.claim({ account: f.a.account });
  return l;
}

const dl = async (f: Portus) => (await f.now()) + 3600n;

describe("third-party liquidity", () => {
  it("LP-01 add at the current ratio, remove pro rata; the price does not move", async () => {
    const f = await deployPortus();
    const l = await live(f);
    const [q0, t0] = await l.pool.read.getReserves();
    const quoteIn = 2n * WAD;
    const tokensNeeded = (quoteIn * t0 + q0 - 1n) / q0;
    await f.fund(f.weth.address, f.a, l.pool.address, quoteIn);
    await l.token.write.approve([l.pool.address, tokensNeeded], { account: f.a.account });
    await l.pool.write.addLiquidity([quoteIn, tokensNeeded, 1n, f.a.account.address, await dl(f)], { account: f.a.account });
    const shares = await l.pool.read.sharesOf([f.a.account.address]);
    assert.ok(shares > 0n);
    const [q1, t1] = await l.pool.read.getReserves();
    assert.equal(q1, q0 + quoteIn);
    assert.equal(t1, t0 + tokensNeeded);
    // Price unchanged up to the rounding that favours the pool.
    assert.ok(q1 * t0 <= q0 * t1);

    const before = await f.weth.read.balanceOf([f.a.account.address]);
    await l.pool.write.removeLiquidity([shares, 1n, 1n, f.a.account.address, await dl(f)], { account: f.a.account });
    const back = (await f.weth.read.balanceOf([f.a.account.address])) - before;
    assert.ok(back <= quoteIn && back >= quoteIn - 2n, `got ${back}`);
    assert.equal(await l.pool.read.sharesOf([f.a.account.address]), 0n);
    assert.equal(await l.pool.read.totalShares(), await l.pool.read.lockedShares());
  });

  it("LP-02 slippage, ownership and locker guards", async () => {
    const f = await deployPortus();
    const l = await live(f);
    await f.fund(f.weth.address, f.a, l.pool.address, WAD);
    await l.token.write.approve([l.pool.address, 10n ** 30n], { account: f.a.account });
    await expectCustom(f.viem, l.pool.write.addLiquidity([WAD, 1n, 0n, f.a.account.address, await dl(f)], { account: f.a.account }), l.pool, "SlippageExceeded");
    await expectCustom(f.viem, l.pool.write.addLiquidity([WAD, 10n ** 30n, 10n ** 30n, f.a.account.address, await dl(f)], { account: f.a.account }), l.pool, "SlippageExceeded");
    await l.pool.write.addLiquidity([WAD, 10n ** 30n, 0n, f.a.account.address, await dl(f)], { account: f.a.account });
    const mine = await l.pool.read.sharesOf([f.a.account.address]);
    await expectCustom(f.viem, l.pool.write.removeLiquidity([mine + 1n, 0n, 0n, f.a.account.address, await dl(f)], { account: f.a.account }), l.pool, "InsufficientShares");
    await expectCustom(f.viem, l.pool.write.removeLiquidity([1n, 0n, 0n, f.b.account.address, await dl(f)], { account: f.b.account }), l.pool, "InsufficientShares");
    // The locker's genesis shares can never be redeemed, even if it could call.
    await f.provider.request({ method: "hardhat_impersonateAccount", params: [f.locker.address] });
    await f.provider.request({ method: "hardhat_setBalance", params: [f.locker.address, "0xde0b6b3a7640000"] });
    await expectCustom(f.viem, l.pool.write.removeLiquidity([1n, 0n, 0n, f.b.account.address, await dl(f)], { account: f.locker.address }), l.pool, "LockedShares");
  });

  it("LP-03 liquidity can be added only after the pool opens", async () => {
    const f = await deployPortus();
    const l = await f.launch();
    await expectCustom(f.viem, l.pool.write.addLiquidity([WAD, WAD, 0n, f.a.account.address, await dl(f)], { account: f.a.account }), l.pool, "NotInitialized");
  });

  it("LP-04 swaps after adding liquidity never reduce value per share", async () => {
    const f = await deployPortus();
    const l = await live(f);
    await f.fund(f.weth.address, f.a, l.pool.address, 5n * WAD);
    await l.token.write.approve([l.pool.address, 10n ** 30n], { account: f.a.account });
    await l.pool.write.addLiquidity([5n * WAD, 10n ** 30n, 0n, f.a.account.address, await dl(f)], { account: f.a.account });
    const vps = async () => {
      const [q, t] = await l.pool.read.getReserves();
      const s = await l.pool.read.totalShares();
      return { qt: q * t, s2: s * s };
    };
    let prev = await vps();
    for (let i = 0; i < 4; i++) {
      await f.fund(f.weth.address, f.b, l.pool.address, WAD);
      await l.pool.write.buy([WAD, 1n, f.b.account.address, await dl(f)], { account: f.b.account });
      const cur = await vps();
      assert.ok(cur.qt * prev.s2 >= prev.qt * cur.s2);
      prev = cur;
    }
  });
});
