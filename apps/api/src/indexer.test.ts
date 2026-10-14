import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Address, Hex } from "viem";
import { createIndexer, deriveSalePhase, type IndexedLog } from "./indexer.js";
import { aggregateCandles } from "./candles.js";

export const FACTORY = "0x00000000000000000000000000000000000000f0" as Address;
export const TOKEN = "0x00000000000000000000000000000000000000a1" as Address;
export const SALE = "0x00000000000000000000000000000000000000a2" as Address;
export const POOL = "0x00000000000000000000000000000000000000a3" as Address;
export const QUOTE = "0x00000000000000000000000000000000000000a4" as Address;
export const CREATOR = "0x00000000000000000000000000000000000000c1" as Address;
const ALICE = "0x00000000000000000000000000000000000000b1" as Address;
const BOB = "0x00000000000000000000000000000000000000b2" as Address;
const TX = `0x${"ab".repeat(32)}` as Hex;
export const ROOT = `0x${"11".repeat(32)}` as Hex;

const log = (address: Address, eventName: string, blockNumber: bigint, logIndex: number, args: Record<string, unknown>): IndexedLog => ({
  address,
  eventName,
  blockNumber,
  logIndex,
  transactionHash: TX,
  args,
});

export function launchLogs(): IndexedLog[] {
  return [
    log(FACTORY, "QuoteAssetSet", 2n, 0, { asset: QUOTE, allowed: true, freezable: false, decimals: 18, minFdv: 1n, maxFdv: 10n ** 30n }),
    log(FACTORY, "LaunchCreated", 3n, 0, {
      launchId: 0n, creator: CREATOR, token: TOKEN, sale: SALE, pool: POOL, quoteAsset: QUOTE,
      raiseTarget: 10n * 10n ** 18n, qSale: 35n * 10n ** 25n, qLp: 35n * 10n ** 25n, qInc: 3n * 10n ** 26n,
      priceNum: 1n, priceDen: 35_000_000n,
    }),
    log(FACTORY, "LaunchRules", 3n, 1, {
      launchId: 0n, feeBps: 100, creatorShareBps: 0, incentiveBps: 3000, startTime: 100n, endTime: 200n,
      publicOpenAt: 100n, publicCap: 10n ** 30n, merkleRoot: ROOT, underRule: 1, minFillBps: 0, treasuryMode: 0,
      metadataHash: `0x${"0".repeat(64)}`,
    }),
  ];
}

function lifecycleLogs(): IndexedLog[] {
  return [
    log(SALE, "Subscribed", 4n, 0, { account: ALICE, amount: 6n * 10n ** 18n, totalForAccount: 6n * 10n ** 18n, totalCommitted: 6n * 10n ** 18n, viaWhitelist: true }),
    log(SALE, "Subscribed", 5n, 0, { account: BOB, amount: 9n * 10n ** 18n, totalForAccount: 9n * 10n ** 18n, totalCommitted: 15n * 10n ** 18n, viaWhitelist: false }),
    log(SALE, "Subscribed", 5n, 1, { account: ALICE, amount: 10n ** 18n, totalForAccount: 7n * 10n ** 18n, totalCommitted: 16n * 10n ** 18n, viaWhitelist: false }),
    log(POOL, "Initialized", 6n, 0, { quoteReserve: 10n ** 19n, tokenReserve: 35n * 10n ** 25n, shares: 1n, locker: FACTORY }),
    log(SALE, "Finalized", 6n, 1, {
      outcome: 1, totalCommitted: 16n * 10n ** 18n, poolQuote: 10n ** 19n, poolTokens: 35n * 10n ** 25n,
      tokensForClaims: 35n * 10n ** 25n, quoteForRefunds: 6n * 10n ** 18n, incentiveFunded: 3n * 10n ** 26n,
      tokensBurned: 0n, quoteDustToSink: 0n,
    }),
    log(SALE, "Claimed", 7n, 0, { account: ALICE, tokens: 5n, refund: 6n, caller: ALICE }),
    log(POOL, "Swap", 8n, 0, { sender: BOB, to: BOB, isBuy: true, amountIn: 10n ** 18n, amountOut: 3n, feeQuote: 10n ** 16n, quoteReserve: 11n * 10n ** 18n - 10n ** 16n, tokenReserve: 35n * 10n ** 25n - 3n }),
    log(POOL, "FeePaid", 8n, 1, { sink: FACTORY, amount: 10n ** 16n }),
  ];
}

describe("event indexer", () => {
  const directory = mkdtempSync(join(tmpdir(), "portus-indexer-"));
  before(() => {
    process.env.DATABASE_PATH = join(directory, "index.db");
  });
  after(async () => {
    const { closeDb } = await import("./db.js");
    closeDb();
    rmSync(directory, { recursive: true, force: true });
  });

  it("builds launch state from create → subscribe → finalize → claim → swap, idempotently", async () => {
    const all = [...launchLogs(), ...lifecycleLogs()];
    const queried: Array<{ addresses: string[]; from: bigint }> = [];
    const indexer = createIndexer({
      chainId: 1,
      factory: FACTORY,
      startBlock: 1n,
      getBlockNumber: async () => 8n,
      getBlockTimestamp: async (b) => Number(b) * 12,
      getLogs: async (addresses, from, to) => {
        queried.push({ addresses: addresses.map((a) => a.toLowerCase()), from });
        const set = new Set(addresses.map((a) => a.toLowerCase()));
        return all.filter((l) => set.has(l.address.toLowerCase()) && l.blockNumber >= from && l.blockNumber <= to);
      },
    });
    await indexer.sync();
    // The child pass includes the sale and pool discovered in the same range.
    assert.deepEqual(queried[1]!.addresses.sort(), [POOL, SALE].map((a) => a.toLowerCase()).sort());

    const row = indexer.getLaunch(TOKEN)!;
    assert.equal(row.total_committed, (16n * 10n ** 18n).toString());
    assert.equal(row.subscriber_count, 2);
    assert.equal(row.outcome, 1);
    assert.equal(row.claimed_count, 1);
    assert.equal(row.merkle_root, ROOT);
    assert.equal(row.under_rule, 1);
    assert.equal(row.fees_quote, (10n ** 16n).toString());
    assert.equal(row.reserve_token, (35n * 10n ** 25n - 3n).toString());
    assert.equal(deriveSalePhase(row, 0), "SUCCEEDED");

    const sub = indexer.getSubscription(TOKEN, ALICE);
    assert.equal(sub.committed, (7n * 10n ** 18n).toString());
    assert.equal(sub.whitelist_committed, (6n * 10n ** 18n).toString());
    assert.equal(sub.public_committed, (10n ** 18n).toString());
    assert.equal(sub.claimed, 1);
    assert.equal(indexer.listSwaps(POOL, null, 10)[0]!.timestamp, 96);
    assert.equal(indexer.listQuoteAssets()[0]!.decimals, 18);

    // Replaying the same range must not double-count anything.
    const { getDb } = await import("./db.js");
    getDb().prepare("UPDATE indexer_progress SET indexed_block = '0'").run();
    await indexer.sync();
    const again = indexer.getLaunch(TOKEN)!;
    assert.equal(again.subscriber_count, 2);
    assert.equal(again.claimed_count, 1);
    assert.equal(again.fees_quote, (10n ** 16n).toString());
    assert.equal(indexer.listSwaps(POOL, null, 10).length, 1);
  });

  it("indexes economics: parameters, the four-way split, buybacks and reward epochs", async () => {
    const SPLITTER = "0x00000000000000000000000000000000000000e1" as Address;
    const DISTRIBUTOR = "0x00000000000000000000000000000000000000e2" as Address;
    const FLYWHEEL = "0x00000000000000000000000000000000000000e3" as Address;
    const TREASURY = "0x00000000000000000000000000000000000000a5" as Address;
    const logs: IndexedLog[] = [
      ...launchLogs(),
      log(FACTORY, "LaunchEconomics", 3n, 2, {
        launchId: 0n, treasury: TREASURY, creatorRecipient: CREATOR, treasuryMode: 1, releaseMode: 1, releaseRateBps: 30,
      }),
      log(SPLITTER, "FeeSplit", 8n, 0, { token: TOKEN, quoteAsset: QUOTE, ecosystem: 20n, flywheel: 20n, creator: 10n, treasury: 50n }),
      log(SPLITTER, "FeeSplit", 9n, 0, { token: TOKEN, quoteAsset: QUOTE, ecosystem: 2n, flywheel: 2n, creator: 1n, treasury: 5n }),
      log(TREASURY, "RewardsFunded", 9n, 1, { amount: 55n }),
      log(DISTRIBUTOR, "RootPublished", 10n, 0, {
        token: TOKEN, asset: QUOTE, epoch: 0n, root: ROOT, total: 55n, claimableAt: 999n, dataURI: "portus-rewards://x",
      }),
      log(DISTRIBUTOR, "Claimed", 11n, 0, { token: TOKEN, asset: QUOTE, epoch: 0n, account: CREATOR, amount: 30n }),
      log(FLYWHEEL, "FlywheelBuyback", 12n, 0, { quoteAsset: QUOTE, pool: POOL, quoteSpent: 7n, tokensBurned: 70n }),
    ];
    const queried: string[][] = [];
    const indexer = createIndexer({
      chainId: 3,
      factory: FACTORY,
      singletons: { feeSplitter: SPLITTER, distributor: DISTRIBUTOR, flywheel: FLYWHEEL },
      startBlock: 1n,
      getBlockNumber: async () => 12n,
      getBlockTimestamp: async () => 0,
      getLogs: async (addresses) => {
        const set = new Set(addresses.map((x) => x.toLowerCase()));
        queried.push([...set]);
        return logs.filter((l) => set.has(l.address.toLowerCase()));
      },
    });
    await indexer.sync();
    // The child pass covers the treasury discovered from LaunchEconomics and the singletons.
    assert.ok(queried[1]!.includes(TREASURY.toLowerCase()) && queried[1]!.includes(SPLITTER.toLowerCase()));
    const row = indexer.getLaunch(TOKEN)!;
    assert.equal(row.treasury, TREASURY.toLowerCase());
    assert.equal(row.treasury_mode, 1);
    assert.equal(row.release_mode, 1);
    assert.equal(row.release_rate_bps, 30);
    assert.deepEqual([row.fees_ecosystem, row.fees_flywheel, row.fees_creator, row.fees_treasury], ["22", "22", "11", "55"]);
    assert.equal(row.rewards_funded, "55");
    assert.deepEqual([row.flywheel_quote, row.flywheel_burned], ["7", "70"]);
    const [ep] = indexer.listEpochs(TOKEN);
    assert.equal(ep!.total, "55");
    assert.equal(ep!.claimed, "30");
    assert.equal(ep!.claimable_at, 999);
  });

  it("resumes from the next block", async () => {
    const froms: bigint[] = [];
    const indexer = createIndexer({
      chainId: 2,
      factory: FACTORY,
      startBlock: 5n,
      getBlockNumber: async () => 9n,
      getBlockTimestamp: async () => 0,
      getLogs: async (_a, from) => {
        froms.push(from);
        return [];
      },
    });
    await indexer.sync();
    assert.equal(indexer.getIndexedBlock(), 9n);
    const later = createIndexer({
      chainId: 2,
      factory: FACTORY,
      startBlock: 5n,
      getBlockNumber: async () => 12n,
      getBlockTimestamp: async () => 0,
      getLogs: async (_a, from) => {
        froms.push(from);
        return [];
      },
    });
    await later.sync();
    assert.deepEqual(froms, [5n, 10n]);
  });

  it("derives phase with the contract's rule", () => {
    const row = { outcome: 0, start_time: 100, end_time: 200 };
    assert.equal(deriveSalePhase(row, 99), "PENDING");
    assert.equal(deriveSalePhase(row, 100), "OPEN");
    assert.equal(deriveSalePhase(row, 200), "AWAITING_FINALIZE");
    assert.equal(deriveSalePhase({ ...row, outcome: 3 }, 0), "REFUNDING");
    assert.equal(deriveSalePhase({ ...row, outcome: 2 }, 0), "SUCCEEDED");
  });

  it("aggregates candles from post-trade prices", () => {
    const c = aggregateCandles(
      [
        { ts: 60, is_buy: 1, amount_in: "100", amount_out: "1", fee_quote: "1", reserve_quote: "2000000000000000000", reserve_token: "1000000000000000000" },
        { ts: 90, is_buy: 0, amount_in: "1", amount_out: "50", fee_quote: "1", reserve_quote: "1000000000000000000", reserve_token: "1000000000000000000" },
        { ts: 130, is_buy: 1, amount_in: "7", amount_out: "1", fee_quote: "0", reserve_quote: "3000000000000000000", reserve_token: "1000000000000000000" },
      ],
      "1m",
    );
    assert.equal(c.length, 2);
    assert.deepEqual(c[0], { t: 60, o: "2000000000000000000", h: "2000000000000000000", l: "1000000000000000000", c: "1000000000000000000", v: "151" });
    assert.equal(c[1]!.v, "7");
  });
});
