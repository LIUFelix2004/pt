import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maxUint128, type Address, zeroAddress } from "viem";
import { deployPortus, expectCustom, subPublic, Outcome, WAD, type Portus } from "./helpers/fixture.js";

async function impersonate(f: Portus, address: Address) {
  await f.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
  await f.provider.request({ method: "hardhat_setBalance", params: [address, "0xde0b6b3a7640000"] });
}

async function filledLaunch(f: Portus) {
  const l = await f.launch();
  await f.jumpTo(l.params.startTime);
  await subPublic(f, l, f.a, 10n * WAD);
  await f.jumpTo(l.params.startTime + l.params.duration);
  await l.sale.write.finalize();
  await l.sale.write.claim({ account: f.a.account });
  return l;
}

const later = async (f: Portus) => (await f.now()) + 3600n;

describe("edge guards", () => {
  it("pool: bindSale twice (as the factory) reverts SaleAlreadyBound", async () => {
    const f = await deployPortus();
    const l = await f.launch();
    await impersonate(f, f.factory.address);
    await expectCustom(f.viem, l.pool.write.bindSale([f.outsider.account.address], { account: f.factory.address }), l.pool, "SaleAlreadyBound");
  });

  it("pool: initialize guards when called by its sale", async () => {
    const f = await deployPortus();
    const l = await f.launch();
    await impersonate(f, l.sale.address);
    const asSale = { account: l.sale.address };
    await expectCustom(f.viem, l.pool.write.initialize([0n, 1n], asSale), l.pool, "ZeroAmount");
    await expectCustom(f.viem, l.pool.write.initialize([1n, 1n], asSale), l.pool, "InsufficientInitialBalance");
    const huge = 2n ** 112n;
    await f.weth.write.mint([l.pool.address, huge]);
    await l.token.write.transfer([l.pool.address, 10n], asSale);
    await expectCustom(f.viem, l.pool.write.initialize([huge, 10n], asSale), l.pool, "ReserveOverflow");
    await l.pool.write.initialize([1000n, 10n], asSale);
    await expectCustom(f.viem, l.pool.write.initialize([1000n, 10n], asSale), l.pool, "AlreadyInitialized");
  });

  it("pool: sell guards and quoteSell before opening", async () => {
    const f = await deployPortus();
    const closed = await f.launch();
    await expectCustom(f.viem, closed.pool.read.quoteSell([1n]), closed.pool, "NotInitialized");

    const l = await filledLaunch(f);
    await l.token.write.approve([l.pool.address, 10n ** 30n], { account: f.a.account });
    // 1 base unit of token is worth less than 1 wei of quote.
    await expectCustom(f.viem, l.pool.write.sell([1n, 0n, f.a.account.address, await later(f)], { account: f.a.account }), l.pool, "InsufficientOutput");
    const amount = 10n ** 24n;
    const [out] = await l.pool.read.quoteSell([amount]);
    await f.viem.assertions.revertWithCustomErrorWithArgs(
      l.pool.write.sell([amount, out + 1n, f.a.account.address, await later(f)], { account: f.a.account }),
      l.pool,
      "SlippageExceeded",
      [out + 1n, out],
    );
  });

  it("pool: a quote asset that starts rebasing after opening is rejected on buy", async () => {
    const f = await deployPortus();
    const q = await f.viem.deployContract("MockRebasingERC20");
    await f.factory.write.setQuoteAsset([q.address, true, false, 1n, maxUint128, zeroAddress, 0n]);
    const l = await f.launch({ quoteAsset: q.address });
    await f.jumpTo(l.params.startTime);
    await q.write.mint([f.a.account.address, 10n * WAD]);
    await q.write.approve([l.sale.address, 10n * WAD], { account: f.a.account });
    await l.sale.write.subscribePublic([10n * WAD], { account: f.a.account });
    await f.jumpTo(l.params.startTime + l.params.duration);
    await l.sale.write.finalize();
    await q.write.setBonusBps([100n]);
    await q.write.mint([f.b.account.address, WAD]);
    await q.write.approve([l.pool.address, WAD], { account: f.b.account });
    await expectCustom(f.viem, l.pool.write.buy([WAD, 1n, f.b.account.address, await later(f)], { account: f.b.account }), l.pool, "UnsupportedToken");
  });

  it("sale: whitelist path checks phase and amount; totals are capped at 2^160", async () => {
    const f = await deployPortus();
    const l = await f.launch({}, [{ account: f.a.account.address, cap: WAD }]);
    const e = l.tree!.entries.get(f.a.account.address.toLowerCase())!;
    await expectCustom(f.viem, l.sale.write.subscribe([WAD, e.cap, e.proof], { account: f.a.account }), l.sale, "NotOpen");
    await f.jumpTo(l.params.startTime);
    await expectCustom(f.viem, l.sale.write.subscribe([0n, e.cap, e.proof], { account: f.a.account }), l.sale, "ZeroAmount");

    const big = await f.launch({ publicCap: 2n ** 200n });
    await f.jumpTo(big.params.startTime);
    const huge = 2n ** 160n + 1n;
    await f.fund(f.weth.address, f.b, big.sale.address, huge);
    await expectCustom(f.viem, big.sale.write.subscribePublic([huge], { account: f.b.account }), big.sale, "TotalCommitTooLarge");
  });

  it("sale: previewSettlement after finalize returns the recorded figures", async () => {
    const f = await deployPortus();
    const l = await filledLaunch(f);
    const [o, poolQuote, poolTokens, burn, toVault, dust] = await l.sale.read.previewSettlement();
    assert.equal(o, Outcome.FILLED);
    assert.equal(poolQuote, await l.sale.read.poolQuote());
    assert.equal(poolTokens, await l.sale.read.poolTokens());
    assert.equal(burn, await l.sale.read.tokensBurned());
    assert.equal(toVault, await l.sale.read.incentiveFunded());
    assert.equal(dust, await l.sale.read.quoteDust());
  });

  it("locker: a pool can lock only once", async () => {
    const f = await deployPortus();
    const l = await filledLaunch(f);
    await impersonate(f, l.pool.address);
    await expectCustom(f.viem, f.locker.write.notifyLocked([1n], { account: l.pool.address }), f.locker, "AlreadyLocked");
  });
});
