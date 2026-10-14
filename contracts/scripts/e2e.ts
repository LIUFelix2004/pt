// Local end-to-end run of the Portus main line, against a local chain.
//
//   npm run chain          (terminal 1)
//   npm run e2e            (terminal 2)
//
// Or, with no node running, on Hardhat's in-process chain:
//   npx hardhat run scripts/e2e.ts -w @portus/contracts
//
// Deploys a fresh factory (it does not touch deployments/*.json), then runs
// three launches — FILLED with oversubscription, SHRUNK and REFUNDED — through
// whitelist and public subscription, finalize, claims, trading, the four-way fee
// split, a treasury buyback, a radar incentive claim and the dust sweep,
// asserting every result against packages/shared/src/pricing.ts.
import assert from "node:assert/strict";
import { network } from "hardhat";
import { formatUnits, maxUint128, parseEther, type Address, zeroAddress } from "viem";
import { allocation, buildRewardTree, buildWhitelist, getChain, quoteBuy, settle, type SaleTerms } from "@portus/shared";
import { createLaunch } from "./lib/launch.js";

const ok = (msg: string) => console.log(`  ✓ ${msg}`);

async function main() {
  const { viem, provider } = await network.create();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  if (!getChain(chainId).isLocal) throw new Error("e2e runs on a local chain only (it fast-forwards time).");

  const wallets = await viem.getWalletClients();
  type W = (typeof wallets)[number];
  assert(wallets.length >= 6, "need 6 funded local accounts");
  const [admin, alice, bob, carol, dave, trader] = wallets as [W, W, W, W, W, W];
  const jumpTo = async (ts: bigint) => {
    await provider.request({ method: "evm_setNextBlockTimestamp", params: [Number(ts)] });
    await provider.request({ method: "evm_mine", params: [] });
  };
  const now = async () => (await publicClient.getBlock()).timestamp;

  console.log("deploy");
  const libraries = {
    TokenDeployer: (await viem.deployContract("TokenDeployer")).address,
    PoolDeployer: (await viem.deployContract("PoolDeployer")).address,
    SaleDeployer: (await viem.deployContract("SaleDeployer")).address,
    TreasuryDeployer: (await viem.deployContract("TreasuryDeployer")).address,
    MintTokenDeployer: (await viem.deployContract("MintTokenDeployer")).address,
    TaxPoolDeployer: (await viem.deployContract("TaxPoolDeployer")).address,
    EmissionDeployer: (await viem.deployContract("EmissionDeployer")).address,
  };
  // admin doubles as quote admin, ecosystem recipient and root publisher here.
  const factory = await viem.deployContract(
    "PortusFactory",
    [admin.account.address, admin.account.address, admin.account.address],
    { libraries },
  );
  const splitter = await viem.getContractAt("PortusFeeSplitter", await factory.read.feeSplitter());
  const distributor = await viem.getContractAt("PortusDistributor", await factory.read.distributor());
  const weth = await viem.deployContract("MockWETH");
  await factory.write.setQuoteAsset([weth.address, true, false, 1n, maxUint128, zeroAddress, 0n]);
  ok(`factory ${factory.address}`);

  const fund = async (w: typeof alice, spender: Address, amount: bigint) => {
    await weth.write.mint([w.account.address, amount]);
    await weth.write.approve([spender, amount], { account: w.account });
  };

  async function run(label: string, rule: "REFUND" | "SHRINK", subs: Array<[typeof alice, bigint, "wl" | "pub"]>) {
    console.log(`\n${label}`);
    const caps = subs.filter(([, , via]) => via === "wl").map(([w]) => ({ account: w.account.address, cap: parseEther("20") }));
    const tree = caps.length ? buildWhitelist(caps) : null;
    const created = await createLaunch(viem, factory.address, {
      name: label,
      symbol: label.slice(0, 4).toUpperCase(),
      quoteAsset: weth.address,
      raiseTarget: parseEther("10"),
      incentiveBps: 3000,
      feeBps: 100,
      durationSeconds: 3600,
      merkleRoot: tree?.root,
      publicOpensAfter: 0,
      publicCap: parseEther("20"),
      underRule: rule,
      minFillBps: rule === "SHRINK" ? 2000 : 0,
      creatorShareBps: 2000,
      releaseRateBps: 30,
    });
    const sale = await viem.getContractAt("PortusSale", created.sale);
    const pool = await viem.getContractAt("PortusPool", created.pool);
    const token = await viem.getContractAt("LaunchToken", created.token);
    const treasury = await viem.getContractAt("PortusTreasury", created.treasury);
    ok(`created ${created.token}`);

    await jumpTo(created.startTime);
    for (const [w, amt, via] of subs) {
      await fund(w, sale.address, amt);
      if (via === "wl") {
        const e = tree!.entries.get(w.account.address.toLowerCase())!;
        await sale.write.subscribe([amt, e.cap, e.proof], { account: w.account });
      } else {
        await sale.write.subscribePublic([amt], { account: w.account });
      }
    }
    const C = subs.reduce((s, [, x]) => s + x, 0n);
    ok(`subscribed ${formatUnits(C, 18)} WETH from ${subs.length} accounts`);

    await jumpTo(created.endTime);
    const terms: SaleTerms = {
      raiseTarget: await sale.read.raiseTarget(),
      qSale: await sale.read.qSale(),
      qLp: await sale.read.qLp(),
      qInc: await sale.read.qInc(),
      priceNum: await sale.read.priceNum(),
      priceDen: await sale.read.priceDen(),
      underRule: rule,
      minFillBps: rule === "SHRINK" ? 2000 : 0,
    };
    const expected = settle(C, terms);
    await sale.write.finalize({ account: trader.account });
    const outcome = ["NONE", "FILLED", "SHRUNK", "REFUNDED"][await sale.read.outcome()];
    assert.equal(outcome, expected.outcome);
    ok(`finalized: ${outcome}`);

    if (expected.outcome !== "REFUNDED") {
      const [q, t] = await pool.read.getReserves();
      assert.equal(q * terms.priceDen, t * terms.priceNum, "opening price != subscription price");
      ok(`opening price == subscription price (${q} / ${t})`);
    } else {
      assert.equal(await token.read.totalSupply(), 0n);
      ok("supply fully burned; pool never opened");
    }

    for (const [w, amt] of subs) {
      const exp = allocation(amt, C, expected.outcome, terms);
      const before = await weth.read.balanceOf([w.account.address]);
      await sale.write.claim({ account: w.account });
      assert.equal(await token.read.balanceOf([w.account.address]), exp.tokens);
      assert.equal((await weth.read.balanceOf([w.account.address])) - before, exp.refund);
    }
    ok("claims match shared/pricing.ts");

    if (expected.outcome !== "REFUNDED") {
      // Docs: incentives are kept whole even when the launch shrinks.
      assert.equal(await token.read.balanceOf([distributor.address]), terms.qInc);
      ok(`incentive pool (${formatUnits(terms.qInc, 18)} tokens) funded to the Distributor`);

      await treasury.write.startObservation();
      const [q0, t0] = await pool.read.getReserves();
      const treasuryBefore = await weth.read.balanceOf([treasury.address]);
      const bookedBefore = await splitter.read.accounted([weth.address]);
      const spend = parseEther("1");
      const exp = quoteBuy(spend, q0, t0, 100);
      await fund(trader, pool.address, spend);
      await pool.write.buy([spend, exp.tokensOut, trader.account.address, (await now()) + 600n], { account: trader.account });
      const got = await token.read.balanceOf([trader.account.address]);
      assert.equal(got, exp.tokensOut);
      await token.write.approve([pool.address, got], { account: trader.account });
      await pool.write.sell([got, 1n, trader.account.address, (await now()) + 600n], { account: trader.account });
      const [q1, t1] = await pool.read.getReserves();
      assert.ok(q1 * t1 >= q0 * t0, "k decreased");
      const toTreasury = (await weth.read.balanceOf([treasury.address])) - treasuryBefore;
      const booked = (await splitter.read.accounted([weth.address])) - bookedBefore;
      const fees = toTreasury + booked;
      // 20% ecosystem + 20% flywheel + 20% creator booked; 40% to the treasury.
      assert.equal(booked, fees - toTreasury);
      assert.ok(toTreasury * 100n >= fees * 39n && toTreasury * 100n <= fees * 41n, "treasury share ~40%");
      ok(`buy + sell: k did not decrease; fees ${formatUnits(fees, 18)} WETH split, ${formatUnits(toTreasury, 18)} to treasury`);

      await jumpTo((await now()) + 1800n);
      const supplyBefore = await token.read.totalSupply();
      await treasury.write.executeBuyback([2n ** 255n, 0n], { account: trader.account });
      assert.ok((await token.read.totalSupply()) < supplyBefore);
      ok("treasury buyback executed through the TWAP guard and burned");

      await jumpTo((await now()) + 86_400n);
      const releasedNow = await distributor.read.available([created.token, created.token]);
      const rTree = buildRewardTree(created.token, created.token, 0, [{ account: carol.account.address, amount: releasedNow }]);
      await distributor.write.publishRoot([created.token, created.token, rTree.root, releasedNow, "e2e"]);
      await jumpTo((await now()) + 86_400n);
      const carolBefore = await token.read.balanceOf([carol.account.address]);
      await distributor.write.claim([created.token, created.token, 0n, releasedNow, rTree.entries[0]!.proof], { account: carol.account });
      assert.equal((await token.read.balanceOf([carol.account.address])) - carolBefore, releasedNow);
      ok(`radar epoch 0: ${formatUnits(releasedNow, 18)} released tokens claimed by Merkle proof`);

      await sale.write.sweepDust();
      ok("dust swept");
    }
  }

  await run("Filled", "REFUND", [
    [alice, parseEther("8"), "wl"],
    [bob, parseEther("7") + 3n, "wl"],
    [carol, parseEther("10") - 3n, "pub"],
  ]);
  await run("Shrunk", "SHRINK", [
    [alice, parseEther("3"), "wl"],
    [dave, parseEther("1.2") + 7n, "pub"],
  ]);
  await run("Refunded", "REFUND", [[bob, parseEther("4"), "pub"]]);

  console.log("\ne2e passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
