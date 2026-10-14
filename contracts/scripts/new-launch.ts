// Create a test launch on the current deployment (local or testnet only).
//
//   LAUNCH_FILE=launch.json npm run new-launch:local -w @portus/contracts
//
// launch.json (all amounts in quote base units, as strings):
//   {
//     "name": "Harbor", "symbol": "HBR",
//     "quoteAsset": "0x…",            // optional: defaults to the first registered asset
//     "raiseTarget": "10000000000000000000",
//     "incentiveBps": 3000, "feeBps": 100,
//     "startIn": 60, "durationSeconds": 172800,
//     "whitelistCsv": "whitelist.csv", // optional: builds the Merkle root
//     "publicOpensAfter": 3600, "publicCap": "1000000000000000000",
//     "underRule": "SHRINK", "minFillBps": 5000
//   }
//
// Without LAUNCH_FILE a small public demo launch is created.
import { network } from "hardhat";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address } from "viem";
import {
  assertKeyIsSafeForChain,
  buildWhitelist,
  getChain,
  parseWhitelistCsv,
  readDeploymentFile,
  whitelistListHash,
} from "@portus/shared";
import { createDemoLaunch, createLaunch, type LaunchSpec } from "./lib/launch.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

async function main() {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const chain = getChain(chainId);
  if (chain.requiresAudit) throw new Error(`new-launch is for local and testnet chains only.`);

  const [signer] = await viem.getWalletClients();
  if (!signer) throw new Error("No signer. Set DEPLOYER_PRIVATE_KEY in .env.");
  assertKeyIsSafeForChain(signer.account.address, chainId);

  const deployment = readDeploymentFile(ROOT, chainId);
  if (!deployment) throw new Error(`No deployments/${chainId}.json. Run the deploy script first.`);
  const factory = deployment.factory as Address;
  const defaultQuote = deployment.quoteAssets[0]?.address as Address | undefined;

  const file = process.env.LAUNCH_FILE;
  if (!file) {
    if (!defaultQuote) throw new Error("No quote asset recorded; pass LAUNCH_FILE with quoteAsset.");
    const demo = await createDemoLaunch(viem, factory, defaultQuote, { saleMinutes: Number(process.env.SALE_MINUTES ?? 60) });
    console.log(`launch #${demo.launchId}  token ${demo.token}  sale ${demo.sale}  pool ${demo.pool}`);
    return;
  }

  const raw = JSON.parse(readFileSync(resolve(file), "utf8")) as Record<string, any>;
  let whitelist: ReturnType<typeof buildWhitelist> | null = null;
  let listHash: string | null = null;
  if (raw.whitelistCsv) {
    const entries = parseWhitelistCsv(readFileSync(resolve(dirname(resolve(file)), raw.whitelistCsv), "utf8"));
    whitelist = buildWhitelist(entries);
    listHash = whitelistListHash(entries);
  }
  const quoteAsset = (raw.quoteAsset ?? defaultQuote) as Address | undefined;
  if (!quoteAsset) throw new Error("quoteAsset missing");

  const spec: LaunchSpec = {
    name: raw.name,
    symbol: raw.symbol,
    quoteAsset,
    raiseTarget: BigInt(raw.raiseTarget),
    feeBps: raw.feeBps,
    creatorShareBps: raw.creatorShareBps,
    incentiveBps: raw.incentiveBps,
    startIn: raw.startIn,
    durationSeconds: raw.durationSeconds,
    merkleRoot: whitelist?.root,
    publicOpensAfter: raw.publicOpensAfter,
    publicCap: raw.publicCap === undefined ? undefined : BigInt(raw.publicCap),
    underRule: raw.underRule,
    minFillBps: raw.minFillBps,
    treasuryMode: raw.treasuryMode,
  };
  const created = await createLaunch(viem, factory, spec);
  console.log(`launch #${created.launchId}`);
  console.log(`  token ${created.token}`);
  console.log(`  sale  ${created.sale}`);
  console.log(`  pool  ${created.pool}`);

  if (whitelist) {
    const dir = resolve(ROOT, "deployments/whitelists");
    mkdirSync(dir, { recursive: true });
    const out = resolve(dir, `${chainId}-${created.token.toLowerCase()}.json`);
    writeFileSync(
      out,
      JSON.stringify(
        {
          token: created.token,
          root: whitelist.root,
          listHash,
          entries: [...whitelist.entries.values()].map((e) => ({ account: e.account, cap: e.cap.toString(), proof: e.proof })),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`  whitelist root ${whitelist.root} → ${out}`);
    console.log(`  Upload it from the creator wallet on /launch/${created.token} so subscribers can fetch proofs.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
