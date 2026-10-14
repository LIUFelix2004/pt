// Populate a LOCAL chain with launches in every phase, for front-end work:
//
//   npm run chain                      (terminal 1)
//   npm run contracts:deploy           (terminal 2)
//   npx hardhat run scripts/demo-states.ts --network localhost -w @portus/contracts
//
// Leaves behind: SUCCEEDED (oversubscribed, claimed, traded), REFUNDING,
// SUCCEEDED via SHRINK, OPEN with a whitelist (proofs in deployments/whitelists),
// and PENDING. Time is fast-forwarded, so any launch already open moves on too.
import { network } from "hardhat";
import { parseEther, type Address } from "viem";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWhitelist, getChain, readDeploymentFile, whitelistListHash } from "@portus/shared";
import { createLaunch } from "./lib/launch.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  const { viem, provider } = await network.create();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  if (!getChain(chainId).isLocal) throw new Error("demo-states fast-forwards time; local chains only.");
  const deployment = readDeploymentFile(ROOT, chainId);
  if (!deployment) throw new Error("deploy first");
  const factory = deployment.factory as Address;
  const weth = await viem.getContractAt("MockWETH", deployment.quoteAssets[0]!.address as Address);
  const wallets = await viem.getWalletClients();
  const [, a, b, c, d, trader] = wallets;
  const now = async () => (await publicClient.getBlock()).timestamp;
  const jumpTo = async (ts: bigint) => {
    await provider.request({ method: "evm_setNextBlockTimestamp", params: [Number(ts)] });
    await provider.request({ method: "evm_mine", params: [] });
  };
  const fund = async (w: typeof a, spender: Address, amount: bigint) => {
    await weth.write.mint([w!.account.address, amount]);
    await weth.write.approve([spender, amount], { account: w!.account });
  };

  // Phase 1: launches that will settle.
  const filled = await createLaunch(viem, factory, {
    name: "Harbor Filled", symbol: "HFIL", quoteAsset: weth.address, raiseTarget: parseEther("10"),
    durationSeconds: 3600, startIn: 30, publicOpensAfter: 0, publicCap: parseEther("20"), feeBps: 100,
    creatorShareBps: 2000, treasuryMode: 0,
  });
  const refunded = await createLaunch(viem, factory, {
    name: "Harbor Refund", symbol: "HREF", quoteAsset: weth.address, raiseTarget: parseEther("50"),
    durationSeconds: 3600, startIn: 30, publicOpensAfter: 0, publicCap: parseEther("20"),
  });
  const shrunk = await createLaunch(viem, factory, {
    name: "Harbor Shrink", symbol: "HSHR", quoteAsset: weth.address, raiseTarget: parseEther("20"),
    durationSeconds: 3600, startIn: 30, publicOpensAfter: 0, publicCap: parseEther("20"), underRule: "SHRINK", minFillBps: 2500,
    feeBps: 300, treasuryMode: 1, releaseMode: "DECAYING", creatorShareBps: 1000,
  });
  await jumpTo(filled.startTime + 10n);
  for (const [launch, subs] of [
    [filled, [[a, "8"], [b, "7"], [c, "9.5"]]],
    [refunded, [[d, "3"]]],
    [shrunk, [[a, "4"], [c, "2.5"]]],
  ] as const) {
    const sale = await viem.getContractAt("PortusSale", launch.sale);
    for (const [w, amt] of subs) {
      await fund(w, sale.address, parseEther(amt));
      await sale.write.subscribePublic([parseEther(amt)], { account: w!.account });
    }
  }
  await jumpTo(filled.endTime + 5n);
  for (const launch of [filled, refunded, shrunk]) {
    await (await viem.getContractAt("PortusSale", launch.sale)).write.finalize();
  }
  await (await viem.getContractAt("PortusSale", filled.sale)).write.claim({ account: a!.account });
  await (await viem.getContractAt("PortusSale", shrunk.sale)).write.claim({ account: a!.account });

  // Trades on the filled pool, spread over time so candles have shape.
  const pool = await viem.getContractAt("PortusPool", filled.pool);
  const token = await viem.getContractAt("LaunchToken", filled.token);
  for (let i = 0; i < 12; i++) {
    await jumpTo((await now()) + 240n);
    if (i % 3 === 2) {
      const bal = await token.read.balanceOf([trader!.account.address]);
      if (bal > 0n) {
        await token.write.approve([pool.address, bal / 2n], { account: trader!.account });
        await pool.write.sell([bal / 2n, 1n, trader!.account.address, (await now()) + 600n], { account: trader!.account });
      }
    } else {
      const amt = parseEther(String(0.2 + i * 0.05));
      await fund(trader, pool.address, amt);
      await pool.write.buy([amt, 1n, trader!.account.address, (await now()) + 600n], { account: trader!.account });
    }
  }

  // A week of activity: daily flywheel checkpoints and trades on both live
  // pools, third-party liquidity on one, so rankings, buybacks and reward
  // epochs have real data. (The keeper / reward publisher act on it.)
  const flywheel = await viem.getContractAt("PortusFlywheel", deployment.flywheel as Address);
  const shrunkPool = await viem.getContractAt("PortusPool", shrunk.pool);
  const filledTreasury = await viem.getContractAt("PortusTreasury", filled.treasury);
  await filledTreasury.write.startObservation();
  const [qa, ta] = await pool.read.getReserves();
  const lpQuote = parseEther("2");
  const lpTokens = (lpQuote * BigInt(ta) + BigInt(qa) - 1n) / BigInt(qa);
  await fund(a, pool.address, lpQuote);
  await token.write.approve([pool.address, lpTokens], { account: a!.account });
  await pool.write.addLiquidity([lpQuote, lpTokens, 1n, a!.account.address, (await now()) + 600n], { account: a!.account });
  for (let day = 0; day < 8; day++) {
    for (const p of [pool, shrunkPool]) {
      await flywheel.write.checkpoint([p.address]);
      const amt = parseEther("0.3");
      await fund(trader, p.address, amt);
      await p.write.buy([amt, 1n, trader!.account.address, (await now()) + 600n], { account: trader!.account });
    }
    await jumpTo((await now()) + 86_400n);
  }

  // Phase 2: launches relative to the new time.
  const list = [
    { account: a!.account.address, cap: parseEther("5") },
    { account: b!.account.address, cap: parseEther("3") },
    { account: wallets[0]!.account.address, cap: parseEther("5") },
  ];
  const tree = buildWhitelist(list);
  const open = await createLaunch(viem, factory, {
    name: "Harbor Whitelist", symbol: "HWL", quoteAsset: weth.address, raiseTarget: parseEther("8"),
    durationSeconds: 48 * 3600, startIn: 30, merkleRoot: tree.root, publicOpensAfter: 24 * 3600, publicCap: parseEther("1"),
  });
  await createLaunch(viem, factory, {
    name: "Harbor Pending", symbol: "HPEN", quoteAsset: weth.address, raiseTarget: parseEther("12"),
    durationSeconds: 48 * 3600, startIn: 2 * 86400, publicOpensAfter: 0, publicCap: parseEther("2"),
  });
  await jumpTo(open.startTime + 1n);
  const openSale = await viem.getContractAt("PortusSale", open.sale);
  const ea = tree.entries.get(a!.account.address.toLowerCase())!;
  await fund(a, openSale.address, parseEther("2"));
  await openSale.write.subscribe([parseEther("2"), ea.cap, ea.proof], { account: a!.account });

  const dir = resolve(ROOT, "deployments/whitelists");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, `${chainId}-${open.token.toLowerCase()}.json`),
    JSON.stringify(
      {
        token: open.token,
        root: tree.root,
        listHash: whitelistListHash(list),
        entries: [...tree.entries.values()].map((e) => ({ account: e.account, cap: e.cap.toString(), proof: e.proof })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`filled   ${filled.token}\nrefunded ${refunded.token}\nshrunk   ${shrunk.token}\nopen(wl) ${open.token}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
