import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEventLogs, zeroAddress, type Hex } from "viem";
import { advance, DAY, deployPortus, expectCustom, Outcome, Rule, WAD, type MintHandle, type Portus } from "./helpers/fixture.js";

const BPS = 10_000n;

async function subscribe(f: Portus, m: MintHandle, wallet: Portus["a"], amount: bigint) {
  await f.fund(m.params.quoteAsset, wallet, m.sale.address, amount);
  return m.sale.write.subscribePublic([amount], { account: wallet.account });
}

/** Create, fill and finalize a mint launch (two subscribers fill the 1M target). */
async function live(f: Portus, over: Parameters<Portus["mintLaunch"]>[0] = {}) {
  const m = await f.mintLaunch(over);
  await f.jumpTo(m.params.startTime);
  await subscribe(f, m, f.a, m.params.raiseTarget / 2n);
  await subscribe(f, m, f.b, m.params.raiseTarget / 2n);
  await f.jumpTo(m.params.startTime + m.params.duration);
  await m.sale.write.finalize();
  return m;
}

const deadline = async (f: Portus) => (await f.now()) + 3600n;

/** Decode one event from a transaction's receipt. */
async function eventOf(f: Portus, hash: Hex, abi: readonly unknown[], eventName: string) {
  const receipt = await f.publicClient.waitForTransactionReceipt({ hash });
  const [ev] = parseEventLogs({ abi: abi as never, logs: receipt.logs, eventName: eventName as never }) as any[];
  assert.ok(ev, `${eventName} not emitted`);
  return ev as { args: Record<string, bigint> };
}

/** Mirror of PortusEmission.targetAtMonth. */
function targetAtMonth(m: MintHandle["params"], months: bigint): bigint {
  let v = m.initialSupply;
  let left = months;
  for (let i = 0; i < 4 && left > 0n; i++) {
    let n = BigInt(m.schedule.months[i]!);
    if (n === 0n) break;
    if (n > left) n = left;
    const g = BPS + BigInt(m.schedule.growthBps[i]!);
    for (let k = 0n; k < n; k++) {
      v = (v * g) / BPS;
      if (v >= m.maxSupply) return m.maxSupply;
    }
    left -= n;
  }
  return v;
}

describe("Mint mode (RADR-style launches)", () => {
  it("M-01 creation: initial supply to the sale, emission is the only minter, price R / (S0/2)", async () => {
    const f = await deployPortus();
    const m = await f.mintLaunch();
    assert.equal(await m.token.read.balanceOf([m.sale.address]), m.params.initialSupply);
    assert.equal(await m.token.read.totalMinted(), m.params.initialSupply);
    assert.equal(await m.token.read.maxSupply(), m.params.maxSupply);
    assert.equal((await m.token.read.minter()).toLowerCase(), m.emission.address.toLowerCase());
    // 1,000,000 / 5,000,000 = 0.2 per token, reduced to 1/5.
    assert.equal(await m.sale.read.priceNum(), 1n);
    assert.equal(await m.sale.read.priceDen(), 5n);
    assert.equal(await m.sale.read.qSale(), 5_000_000n * WAD);
    assert.equal(await m.sale.read.qInc(), 0n);
    assert.equal(await f.factory.read.isMintPool([m.pool.address]), true);
    assert.equal(await f.factory.read.isPool([m.pool.address]), false);
    assert.equal(
      (await f.factory.read.emissionOf([m.token.address])).toLowerCase(),
      m.emission.address.toLowerCase(),
    );
    // Nobody but the emission can mint, and the minter is wired only once.
    await expectCustom(f.viem, m.token.write.mint([f.a.account.address, 1n]), m.token, "NotMinter");
    await expectCustom(f.viem, m.token.write.setMinter([f.a.account.address]), m.token, "NotFactory");
  });

  it("M-02 validation: supply, schedule and tax bounds", async () => {
    const f = await deployPortus();
    const create = async (over: Parameters<Portus["mintDefaults"]>[0]) =>
      f.factory.write.createMintLaunch([(await f.mintDefaults(over)) as never], { account: f.creator.account });
    const base = await f.mintDefaults();
    await expectCustom(f.viem, create({ initialSupply: 10_000_000n * WAD + 1n }), f.factory, "InvalidSupply");
    await expectCustom(f.viem, create({ maxSupply: 1n * WAD }), f.factory, "InvalidSupply");
    await expectCustom(f.viem, create({ schedule: { months: [6, 0, 36, 0], growthBps: [1000, 0, 300, 0] } }), f.factory, "InvalidMintSchedule");
    await expectCustom(f.viem, create({ schedule: { months: [6, 0, 0, 0], growthBps: [2001, 0, 0, 0] } }), f.factory, "InvalidMintSchedule");
    await expectCustom(f.viem, create({ schedule: { months: [0, 0, 0, 0], growthBps: [0, 0, 0, 0] } }), f.factory, "InvalidMintSchedule");
    await expectCustom(f.viem, create({ staticBps: 10_001 }), f.factory, "InvalidMintSchedule");
    await expectCustom(f.viem, create({ tax: { ...base.tax, buyBurnBps: 900 } }), f.factory, "InvalidTax");
    await expectCustom(f.viem, create({ tax: { ...base.tax, community: zeroAddress } }), f.factory, "InvalidTax");
    await expectCustom(f.viem, create({ tax: { ...base.tax, tech: zeroAddress } }), f.factory, "InvalidTax");
    await expectCustom(f.viem, create({ tax: { ...base.tax, dumpThresholdBps: 50 } }), f.factory, "InvalidTax");
    await expectCustom(f.viem, create({ tax: { ...base.tax, market: zeroAddress } }), f.factory, "InvalidTax");
    // A fully burned levy needs no market address; no levy at all is allowed too.
    await create({ tax: { ...base.tax, dumpBurnShareBps: 10_000, market: zeroAddress } });
    await create({ tax: { ...base.tax, dumpThresholdBps: 0, dumpBurnShareBps: 0, market: zeroAddress } });
  });

  it("M-03 finalize opens the taxed pool at exactly the subscription price", async () => {
    const f = await deployPortus();
    const m = await live(f);
    assert.equal(await m.sale.read.outcome(), Outcome.FILLED);
    const [q, t] = await m.pool.read.getReserves();
    assert.equal(q, m.params.raiseTarget);
    assert.equal(t, 5_000_000n * WAD);
    assert.equal(q * 5n, t); // 0.2 per token
    assert.equal(await m.token.read.totalSupply(), m.params.initialSupply);
  });

  it("M-04 buy tax: 1% burned, 1% community, 1% foundation, taken in tokens", async () => {
    const f = await deployPortus();
    const m = await live(f);
    const [q, t] = await m.pool.read.getReserves();
    const quoteIn = 1000n * WAD;
    const gross = (quoteIn * t) / (q + quoteIn);
    const each = (gross * 100n) / BPS;
    const [preview, tax] = await m.pool.read.quoteBuy([quoteIn]);
    assert.equal(tax, 3n * each);
    assert.equal(preview, gross - 3n * each);

    const supply = await m.token.read.totalSupply();
    await f.fund(f.weth.address, f.c, m.pool.address, quoteIn);
    await m.pool.write.buy([quoteIn, preview, f.c.account.address, await deadline(f)], { account: f.c.account });
    assert.equal(await m.token.read.balanceOf([f.c.account.address]), preview);
    assert.equal(await m.token.read.balanceOf([m.params.tax.community]), each);
    assert.equal(await m.token.read.balanceOf([m.params.tax.foundation]), each);
    assert.equal(await m.token.read.totalSupply(), supply - each);
    const [q2, t2] = await m.pool.read.getReserves();
    assert.equal(q2, q + quoteIn);
    assert.equal(t2, t - gross);
  });

  it("M-05 sell tax below the anti-dump threshold: 1% burn, 1% community, 1% tech, no levy", async () => {
    const f = await deployPortus();
    const m = await live(f);
    await m.sale.write.claim({ account: f.a.account });
    const [q, t] = await m.pool.read.getReserves();
    const tokensIn = 10_000n * WAD; // 0.2% of the token reserve
    const each = (tokensIn * 100n) / BPS;
    const net = tokensIn - 3n * each;
    const [preview, tax] = await m.pool.read.quoteSell([tokensIn]);
    assert.equal(tax, 3n * each);
    assert.equal(preview, (net * q) / (t + net));

    const before = await f.weth.read.balanceOf([f.a.account.address]);
    await m.token.write.approve([m.pool.address, tokensIn], { account: f.a.account });
    const hash = await m.pool.write.sell([tokensIn, preview, f.a.account.address, await deadline(f)], {
      account: f.a.account,
    });
    assert.equal((await f.weth.read.balanceOf([f.a.account.address])) - before, preview);
    assert.equal(await m.token.read.balanceOf([m.params.tax.tech]), each);
    assert.equal(await m.token.read.balanceOf([m.params.tax.market]), 0n);
    const ev = await eventOf(f, hash, m.pool.abi, "Taxed");
    assert.equal(ev.args.dumpBurned, 0n);
  });

  it("M-06 anti-dump: a sell with >3% price impact pays the excess impact, half burned, half to market", async () => {
    const f = await deployPortus();
    const m = await live(f);
    await m.sale.write.claim({ account: f.a.account });
    const [q, t] = await m.pool.read.getReserves();
    const tokensIn = 500_000n * WAD; // ~9% of the token reserve
    const each = (tokensIn * 100n) / BPS;
    let net = tokensIn - 3n * each;
    const impact = (net * BPS) / (t + net);
    assert.ok(impact > 300n);
    const levy = (net * (impact - 300n)) / BPS;
    const levyBurn = (levy * 5000n) / BPS;
    net -= levy;
    const [preview, tax] = await m.pool.read.quoteSell([tokensIn]);
    assert.equal(tax, 3n * each + levy);
    assert.equal(preview, (net * q) / (t + net));

    const supply = await m.token.read.totalSupply();
    await m.token.write.approve([m.pool.address, tokensIn], { account: f.a.account });
    await m.pool.write.sell([tokensIn, preview, f.a.account.address, await deadline(f)], { account: f.a.account });
    assert.equal(await m.token.read.balanceOf([m.params.tax.market]), levy - levyBurn);
    assert.equal(await m.token.read.totalSupply(), supply - each - levyBurn);
    const [, t2] = await m.pool.read.getReserves();
    assert.equal(t2, t + net);
  });

  it("M-07 emission: nothing before success; day 1 mints 1/30 of month 1's growth into the distributor", async () => {
    const f = await deployPortus();
    const m = await f.mintLaunch();
    await expectCustom(f.viem, m.emission.write.mintDaily(), m.emission, "NotActive");
    await f.jumpTo(m.params.startTime);
    await subscribe(f, m, f.a, m.params.raiseTarget);
    await f.jumpTo(m.params.startTime + m.params.duration);
    await m.sale.write.finalize();
    await expectCustom(f.viem, m.emission.write.mintDaily(), m.emission, "NothingToMint");

    await advance(f, DAY);
    const expected = (targetAtMonth(m.params, 1n) - m.params.initialSupply) / 30n;
    assert.equal(await m.emission.read.mintable(), expected);
    const mintHash = await m.emission.write.mintDaily({ account: f.outsider.account });
    assert.equal(await m.token.read.balanceOf([f.distributor.address]), expected);
    assert.equal(await f.distributor.read.available([m.token.address, m.token.address]), expected);
    await expectCustom(f.viem, m.emission.write.mintDaily(), m.emission, "NothingToMint");
    const ev = await eventOf(f, mintHash, m.emission.abi, "Minted");
    assert.equal(ev.args.staticAmount, expected / 2n);
    assert.equal(ev.args.dynamicAmount, expected - expected / 2n);

    // The publisher can allocate at most what was minted.
    await expectCustom(
      f.viem,
      f.distributor.write.publishRoot([m.token.address, m.token.address, `0x${"11".repeat(32)}`, expected + 1n, ""], {
        account: f.publisher.account,
      }),
      f.distributor,
      "ExceedsAvailable",
    );
    await f.distributor.write.publishRoot([m.token.address, m.token.address, `0x${"11".repeat(32)}`, expected, ""], {
      account: f.publisher.account,
    });
  });

  it("M-08 schedule: compounding per phase, linear within a month, capped at maxSupply", async () => {
    const f = await deployPortus();
    const m = await live(f);
    for (const month of [0n, 1n, 6n, 7n, 42n, 78n, 100n]) {
      assert.equal(await m.emission.read.targetAtMonth([month]), targetAtMonth(m.params, month), `month ${month}`);
    }
    // With the default schedule the cap is reached inside phase 4 and stays there.
    assert.equal(await m.emission.read.targetAtMonth([240n]), m.params.maxSupply);
    const a = await m.emission.read.targetAtMonth([1n]);
    const b = await m.emission.read.targetAtMonth([2n]);
    assert.equal(await m.emission.read.targetAtDay([45n]), a + ((b - a) * 15n) / 30n);

    // Far in the future one call mints up to the cap and no further.
    await advance(f, 240n * 30n * DAY);
    await m.emission.write.mintDaily();
    assert.equal(await m.token.read.totalMinted(), m.params.maxSupply);
    await expectCustom(f.viem, m.emission.write.mintDaily(), m.emission, "NothingToMint");
  });

  it("M-09 a refunded sale never mints", async () => {
    const f = await deployPortus();
    const m = await f.mintLaunch({ underRule: Rule.REFUND });
    await f.jumpTo(m.params.startTime);
    await subscribe(f, m, f.a, 1000n * WAD);
    await f.jumpTo(m.params.startTime + m.params.duration);
    await m.sale.write.finalize();
    assert.equal(await m.sale.read.outcome(), Outcome.REFUNDED);
    await advance(f, 30n * DAY);
    assert.equal(await m.emission.read.mintable(), 0n);
    await expectCustom(f.viem, m.emission.write.mintDaily(), m.emission, "NotActive");
  });

  it("M-10 shrunk sale opens at the same price; sync folds stray quote into the locked reserves", async () => {
    const f = await deployPortus();
    const m = await f.mintLaunch({ underRule: Rule.SHRINK, minFillBps: 2000 });
    await f.jumpTo(m.params.startTime);
    await subscribe(f, m, f.a, 300_000n * WAD);
    await f.jumpTo(m.params.startTime + m.params.duration);
    await m.sale.write.finalize();
    assert.equal(await m.sale.read.outcome(), Outcome.SHRUNK);
    const [q, t] = await m.pool.read.getReserves();
    assert.equal(q * 5n, t);
    // Any stray quote (the sale's dust goes here too) deepens the locked liquidity.
    await f.weth.write.mint([m.pool.address, 7n]);
    await m.pool.write.sync({ account: f.outsider.account });
    const [q2] = await m.pool.read.getReserves();
    assert.equal(q2, q + 7n);
    // Emission still runs on the nominal schedule.
    await advance(f, DAY);
    assert.ok((await m.emission.read.mintable()) > 0n);
  });

  it("M-11 the pool has no liquidity exit and the flywheel cannot select it", async () => {
    const f = await deployPortus();
    const m = await live(f);
    // The tax pool's ABI has no add/remove functions at all.
    const names: string[] = m.pool.abi.filter((x) => x.type === "function").map((x) => x.name);
    assert.ok(!names.includes("removeLiquidity") && !names.includes("addLiquidity"));
    await expectCustom(f.viem, f.flywheel.write.checkpoint([m.pool.address]), f.flywheel, "UnknownPool");
  });
});
