import type { Address, Hex, LaunchOnchainFacts, SalePhase, SwapRecord } from "@portus/shared";
import { OUTCOMES, UNDERFILL_RULES } from "@portus/shared";
import { getDb, transaction } from "./db.js";

/**
 * Event-sourced index of every Portus launch under one factory.
 *
 * Scan order per sync: the factory first (new launches register their sale and
 * pool addresses), then every known sale and pool over the same block range.
 * Factory and children always advance to the same height, so a launch created
 * in this range is fully covered by the child scan that follows. Every write
 * for one sync is a single SQLite transaction, deduplicated by
 * (contract, block, logIndex), so a crash or a re-run replays cleanly.
 */

export interface IndexedLog {
  eventName: string;
  address: Address;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
  args: Record<string, unknown>;
}

export interface IndexerDependencies {
  chainId: number;
  factory: Address;
  /** Platform singletons whose events are indexed alongside each launch. */
  singletons?: { feeSplitter: Address; distributor: Address; flywheel: Address };
  /** Block to start from when nothing has been indexed (deployment block). */
  startBlock: bigint;
  getBlockNumber(): Promise<bigint>;
  getLogs(addresses: Address[], fromBlock: bigint, toBlock: bigint): Promise<IndexedLog[]>;
  getBlockTimestamp(blockNumber: bigint): Promise<number>;
  readSymbol?(asset: Address): Promise<string | null>;
  /** On-chain ERC-20 name/symbol of a launch token, used when no copy was uploaded. */
  readTokenMeta?(token: Address): Promise<{ name: string; symbol: string } | null>;
}

export interface LaunchRow {
  chain_id: number;
  token: string;
  launch_id: number;
  creator: string;
  sale: string;
  pool: string;
  quote_asset: string;
  raise_target: string;
  q_sale: string;
  q_lp: string;
  q_inc: string;
  price_num: string;
  price_den: string;
  fee_bps: number;
  creator_share_bps: number;
  incentive_bps: number;
  start_time: number;
  end_time: number;
  public_open_at: number;
  public_cap: string;
  merkle_root: string;
  under_rule: number;
  min_fill_bps: number;
  treasury_mode: number;
  metadata_hash: string;
  total_committed: string;
  subscriber_count: number;
  claimed_count: number;
  outcome: number;
  pool_quote: string | null;
  pool_tokens: string | null;
  tokens_burned: string | null;
  quote_dust: string | null;
  incentive_funded: string | null;
  reserve_quote: string | null;
  reserve_token: string | null;
  fees_quote: string;
  dust_swept: number;
  token_name: string | null;
  token_symbol: string | null;
  treasury: string | null;
  creator_recipient: string | null;
  release_mode: number;
  release_rate_bps: number;
  fees_ecosystem: string;
  fees_flywheel: string;
  fees_creator: string;
  fees_treasury: string;
  buyback_quote: string;
  buyback_burned: string;
  flywheel_quote: string;
  flywheel_burned: string;
  rewards_funded: string;
  incentive_start: number;
  mint_config: string | null;
  minted_total: string;
  tax_burned: string;
  tax_paid: string;
  created_block: string;
}

const str = (v: unknown) => (typeof v === "bigint" ? v.toString() : String(v));
const lc = (v: unknown) => String(v).toLowerCase();

/** Same rule as PortusSale.phase(), evaluated against chain time. */
export function deriveSalePhase(row: Pick<LaunchRow, "outcome" | "start_time" | "end_time">, now: number): SalePhase {
  if (row.outcome === 3) return "REFUNDING";
  if (row.outcome !== 0) return "SUCCEEDED";
  if (now < row.start_time) return "PENDING";
  if (now < row.end_time) return "OPEN";
  return "AWAITING_FINALIZE";
}

export function rowToFacts(row: LaunchRow, now: number, indexedAtBlock: number): LaunchOnchainFacts {
  return {
    launchId: row.launch_id,
    creator: row.creator as Address,
    token: row.token as Address,
    sale: row.sale as Address,
    pool: row.pool as Address,
    quoteAsset: row.quote_asset as Address,
    raiseTarget: row.raise_target,
    qSale: row.q_sale,
    qLp: row.q_lp,
    qInc: row.q_inc,
    priceNum: row.price_num,
    priceDen: row.price_den,
    feeBps: row.fee_bps,
    creatorShareBps: row.creator_share_bps,
    incentiveBps: row.incentive_bps,
    startTime: row.start_time,
    endTime: row.end_time,
    publicOpenAt: row.public_open_at,
    publicCap: row.public_cap,
    merkleRoot: row.merkle_root as Hex,
    underRule: UNDERFILL_RULES[row.under_rule] ?? "REFUND",
    minFillBps: row.min_fill_bps,
    treasuryMode: row.treasury_mode,
    metadataHash: row.metadata_hash as Hex,
    phase: deriveSalePhase(row, now),
    totalCommitted: row.total_committed,
    subscriberCount: row.subscriber_count,
    claimedCount: row.claimed_count,
    outcome: OUTCOMES[row.outcome] ?? "NONE",
    poolQuote: row.pool_quote,
    poolTokens: row.pool_tokens,
    tokensBurned: row.tokens_burned,
    quoteDust: row.quote_dust,
    incentiveFunded: row.incentive_funded,
    reserveQuote: row.reserve_quote,
    reserveToken: row.reserve_token,
    indexedAtBlock,
  };
}

export function createIndexer(deps: IndexerDependencies) {
  const chainId = deps.chainId;
  const factory = deps.factory.toLowerCase();

  const progressOf = (address: string): bigint | null => {
    const row = getDb()
      .prepare("SELECT indexed_block FROM indexer_progress WHERE chain_id = ? AND contract_address = ?")
      .get(chainId, address) as { indexed_block: string } | undefined;
    return row ? BigInt(row.indexed_block) : null;
  };
  const getIndexedBlock = () => progressOf(factory) ?? deps.startBlock - 1n;

  const singles = deps.singletons
    ? {
        splitter: deps.singletons.feeSplitter.toLowerCase(),
        distributor: deps.singletons.distributor.toLowerCase(),
        flywheel: deps.singletons.flywheel.toLowerCase(),
      }
    : null;

  const childAddresses = (): string[] => {
    const rows = getDb()
      .prepare("SELECT sale, pool, treasury FROM launches WHERE chain_id = ?")
      .all(chainId) as Array<{ sale: string; pool: string; treasury: string | null }>;
    const out = rows.flatMap((r) => (r.treasury ? [r.sale, r.pool, r.treasury] : [r.sale, r.pool]));
    if (singles) out.push(singles.splitter, singles.distributor, singles.flywheel);
    return out;
  };

  const add = (a: string | null | undefined, b: unknown) => (BigInt(a ?? "0") + BigInt(str(b))).toString();

  const launchBy = (column: "sale" | "pool" | "token" | "treasury", address: string) =>
    getDb().prepare(`SELECT * FROM launches WHERE chain_id = ? AND ${column} = ?`).get(chainId, address) as unknown as LaunchRow | undefined;

  const setLaunch = (token: string, fields: Record<string, string | number | null>) => {
    const keys = Object.keys(fields);
    getDb()
      .prepare(`UPDATE launches SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE chain_id = ? AND token = ?`)
      .run(...keys.map((k) => fields[k]!), chainId, token);
  };

  const pendingSymbols: string[] = [];
  const pendingTokens: string[] = [];

  /** Apply one log. Returns false when it was already applied. */
  const applyLog = (log: IndexedLog, ts: (block: bigint) => number): boolean => {
    const db = getDb();
    const address = log.address.toLowerCase();
    const fresh = db
      .prepare("INSERT OR IGNORE INTO indexed_events VALUES (?, ?, ?, ?)")
      .run(chainId, address, log.blockNumber.toString(), log.logIndex);
    if (fresh.changes === 0) return false;
    const a = log.args;

    if (address === factory) {
      switch (log.eventName) {
        case "QuoteAssetChecks":
          db.prepare("UPDATE quote_assets SET price_source = ?, min_pool_liquidity = ? WHERE chain_id = ? AND address = ?").run(
            lc(a.priceSource), str(a.minPoolLiquidity), chainId, lc(a.asset),
          );
          break;
        case "LaunchEconomics": {
          const row = db
            .prepare("SELECT token FROM launches WHERE chain_id = ? AND launch_id = ?")
            .get(chainId, Number(a.launchId)) as { token: string } | undefined;
          if (row) {
            setLaunch(row.token, {
              treasury: lc(a.treasury),
              creator_recipient: lc(a.creatorRecipient),
              treasury_mode: Number(a.treasuryMode),
              release_mode: Number(a.releaseMode),
              release_rate_bps: Number(a.releaseRateBps),
            });
          }
          break;
        }
        case "QuoteAssetSet":
          db.prepare(
            `INSERT INTO quote_assets (chain_id, address, allowed, freezable, decimals, min_fdv, max_fdv)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(chain_id, address) DO UPDATE SET allowed = excluded.allowed, freezable = excluded.freezable,
               decimals = excluded.decimals, min_fdv = excluded.min_fdv, max_fdv = excluded.max_fdv`,
          ).run(chainId, lc(a.asset), a.allowed ? 1 : 0, a.freezable ? 1 : 0, Number(a.decimals), str(a.minFdv), str(a.maxFdv));
          pendingSymbols.push(lc(a.asset));
          break;
        case "LaunchCreated":
          db.prepare(
            `INSERT OR IGNORE INTO launches (chain_id, token, launch_id, creator, sale, pool, quote_asset,
               raise_target, q_sale, q_lp, q_inc, price_num, price_den, created_block, created_tx)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            chainId, lc(a.token), Number(a.launchId), lc(a.creator), lc(a.sale), lc(a.pool), lc(a.quoteAsset),
            str(a.raiseTarget), str(a.qSale), str(a.qLp), str(a.qInc), str(a.priceNum), str(a.priceDen),
            log.blockNumber.toString(), log.transactionHash,
          );
          pendingTokens.push(lc(a.token));
          // Children are scanned from here on; this sync's child pass covers this block.
          break;
        case "MintLaunch":
          setLaunch(lc(a.token), {
            treasury: lc(a.emission),
            mint_config: JSON.stringify({
              emission: lc(a.emission),
              initialSupply: str(a.initialSupply),
              maxSupply: str(a.maxSupply),
              staticBps: Number(a.staticBps),
              schedule: {
                months: (a.schedule as { months: readonly number[] }).months.map(Number),
                growthBps: (a.schedule as { growthBps: readonly number[] }).growthBps.map(Number),
              },
            }),
          });
          break;
        case "MintTaxSet": {
          const row = launchBy("token", lc(a.token));
          if (row?.mint_config) {
            const t = a.tax as Record<string, unknown>;
            const tax = Object.fromEntries(
              Object.entries(t).map(([k, v]) => [k, typeof v === "string" ? v.toLowerCase() : Number(v)]),
            );
            setLaunch(row.token, { mint_config: JSON.stringify({ ...JSON.parse(row.mint_config), tax }) });
          }
          break;
        }
        case "LaunchRules": {
          const row = db
            .prepare("SELECT token FROM launches WHERE chain_id = ? AND launch_id = ?")
            .get(chainId, Number(a.launchId)) as { token: string } | undefined;
          if (row) {
            setLaunch(row.token, {
              fee_bps: Number(a.feeBps),
              creator_share_bps: Number(a.creatorShareBps),
              incentive_bps: Number(a.incentiveBps),
              start_time: Number(a.startTime),
              end_time: Number(a.endTime),
              public_open_at: Number(a.publicOpenAt),
              public_cap: str(a.publicCap),
              merkle_root: lc(a.merkleRoot),
              under_rule: Number(a.underRule),
              min_fill_bps: Number(a.minFillBps),
              treasury_mode: Number(a.treasuryMode),
              metadata_hash: lc(a.metadataHash),
            });
          }
          break;
        }
      }
      return true;
    }

    const saleLaunch = launchBy("sale", address);
    if (saleLaunch) {
      const token = saleLaunch.token;
      switch (log.eventName) {
        case "Subscribed": {
          const account = lc(a.account);
          const prev = db
            .prepare("SELECT whitelist_committed, public_committed FROM subscriptions WHERE chain_id = ? AND token = ? AND account = ?")
            .get(chainId, token, account) as { whitelist_committed: string; public_committed: string } | undefined;
          const amount = BigInt(str(a.amount));
          const wl = BigInt(prev?.whitelist_committed ?? "0") + (a.viaWhitelist ? amount : 0n);
          const pub = BigInt(prev?.public_committed ?? "0") + (a.viaWhitelist ? 0n : amount);
          db.prepare(
            `INSERT INTO subscriptions (chain_id, token, account, committed, whitelist_committed, public_committed)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(chain_id, token, account) DO UPDATE SET committed = excluded.committed,
               whitelist_committed = excluded.whitelist_committed, public_committed = excluded.public_committed`,
          ).run(chainId, token, account, str(a.totalForAccount), wl.toString(), pub.toString());
          setLaunch(token, {
            total_committed: str(a.totalCommitted),
            subscriber_count: saleLaunch.subscriber_count + (prev ? 0 : 1),
          });
          break;
        }
        case "Finalized":
          setLaunch(token, {
            outcome: Number(a.outcome),
            total_committed: str(a.totalCommitted),
            pool_quote: str(a.poolQuote),
            pool_tokens: str(a.poolTokens),
            tokens_burned: str(a.tokensBurned),
            quote_dust: str(a.quoteDustToSink),
            incentive_funded: str(a.incentiveFunded),
          });
          break;
        case "Claimed":
          db.prepare(
            `UPDATE subscriptions SET claimed = 1, tokens_claimed = ?, refund_claimed = ?
             WHERE chain_id = ? AND token = ? AND account = ?`,
          ).run(str(a.tokens), str(a.refund), chainId, token, lc(a.account));
          setLaunch(token, { claimed_count: saleLaunch.claimed_count + 1 });
          break;
        case "DustSwept":
          setLaunch(token, {
            dust_swept: 1,
            tokens_burned: (BigInt(saleLaunch.tokens_burned ?? "0") + BigInt(str(a.tokensBurned))).toString(),
          });
          break;
      }
      return true;
    }

    if (singles && address === singles.splitter && log.eventName === "FeeSplit") {
      const row = launchBy("token", lc(a.token));
      if (row) {
        setLaunch(row.token, {
          fees_ecosystem: add(row.fees_ecosystem, a.ecosystem),
          fees_flywheel: add(row.fees_flywheel, a.flywheel),
          fees_creator: add(row.fees_creator, a.creator),
          fees_treasury: add(row.fees_treasury, a.treasury),
        });
      }
      return true;
    }
    if (singles && address === singles.flywheel && log.eventName === "FlywheelBuyback") {
      const row = launchBy("pool", lc(a.pool));
      if (row) {
        setLaunch(row.token, {
          flywheel_quote: add(row.flywheel_quote, a.quoteSpent),
          flywheel_burned: add(row.flywheel_burned, a.tokensBurned),
        });
      }
      return true;
    }
    if (singles && address === singles.distributor) {
      if (log.eventName === "ReferrerBound") {
        db.prepare(
          `INSERT OR REPLACE INTO referrals (chain_id, account, referrer, bound_at, bound_block, tx_hash)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(chainId, lc(a.account), lc(a.referrer), ts(log.blockNumber), log.blockNumber.toString(), log.transactionHash);
      } else if (log.eventName === "IncentiveFunded") {
        const row = launchBy("token", lc(a.token));
        if (row) setLaunch(row.token, { incentive_start: Number(a.start) });
      } else if (log.eventName === "RootPublished") {
        db.prepare(
          `INSERT OR IGNORE INTO reward_epochs (chain_id, token, asset, epoch, root, total, claimable_at, data_uri)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(chainId, lc(a.token), lc(a.asset), Number(a.epoch), lc(a.root), str(a.total), Number(a.claimableAt), String(a.dataURI));
      } else if (log.eventName === "Claimed") {
        const row = db
          .prepare("SELECT claimed FROM reward_epochs WHERE chain_id = ? AND token = ? AND asset = ? AND epoch = ?")
          .get(chainId, lc(a.token), lc(a.asset), Number(a.epoch)) as { claimed: string } | undefined;
        if (row) {
          db.prepare("UPDATE reward_epochs SET claimed = ? WHERE chain_id = ? AND token = ? AND asset = ? AND epoch = ?").run(
            add(row.claimed, a.amount), chainId, lc(a.token), lc(a.asset), Number(a.epoch),
          );
        }
      }
      return true;
    }

    const treasuryLaunch = launchBy("treasury", address);
    if (treasuryLaunch) {
      if (log.eventName === "Minted") {
        setLaunch(treasuryLaunch.token, { minted_total: add(treasuryLaunch.minted_total, a.amount) });
        return true;
      }
      if (log.eventName === "Buyback") {
        setLaunch(treasuryLaunch.token, {
          buyback_quote: add(treasuryLaunch.buyback_quote, a.quoteSpent),
          buyback_burned: add(treasuryLaunch.buyback_burned, a.tokensBurned),
        });
      } else if (log.eventName === "RewardsFunded") {
        setLaunch(treasuryLaunch.token, { rewards_funded: add(treasuryLaunch.rewards_funded, a.amount) });
      }
      return true;
    }

    const poolLaunch = launchBy("pool", address);
    if (poolLaunch) {
      const token = poolLaunch.token;
      switch (log.eventName) {
        case "Initialized":
          setLaunch(token, { reserve_quote: str(a.quoteReserve), reserve_token: str(a.tokenReserve) });
          break;
        case "Swap":
          db.prepare(`INSERT OR IGNORE INTO swaps VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            chainId, address, log.blockNumber.toString(), log.logIndex, log.transactionHash, ts(log.blockNumber),
            lc(a.sender), lc(a.to), a.isBuy ? 1 : 0, str(a.amountIn), str(a.amountOut), str(a.feeQuote),
            str(a.quoteReserve), str(a.tokenReserve),
          );
          setLaunch(token, {
            reserve_quote: str(a.quoteReserve),
            reserve_token: str(a.tokenReserve),
            last_swap_block: log.blockNumber.toString(),
          });
          break;
        case "FeePaid":
          setLaunch(token, { fees_quote: (BigInt(poolLaunch.fees_quote) + BigInt(str(a.amount))).toString() });
          break;
        case "Taxed": {
          const burned = BigInt(str(a.burned)) + BigInt(str(a.dumpBurned));
          const paid = BigInt(str(a.community)) + BigInt(str(a.second)) + BigInt(str(a.dumpMarket));
          setLaunch(token, {
            tax_burned: add(poolLaunch.tax_burned, burned),
            tax_paid: add(poolLaunch.tax_paid, paid),
          });
          break;
        }
      }
    }
    return true;
  };

  const order = (x: IndexedLog, y: IndexedLog) =>
    x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1;

  const sync = async (): Promise<bigint> => {
    const latest = await deps.getBlockNumber();
    const from = getIndexedBlock() + 1n;
    if (from > latest) return latest;

    // Pass 1: factory. Apply inside a transaction so new launches are visible
    // to pass 2, then commit everything together with the child logs.
    const factoryLogs = (await deps.getLogs([deps.factory], from, latest)).sort(order);
    const knownBefore = new Set(childAddresses());
    const newChildren = new Set<string>();
    for (const log of factoryLogs) {
      if (log.eventName === "LaunchCreated") {
        newChildren.add(lc(log.args.sale));
        newChildren.add(lc(log.args.pool));
      }
      if (log.eventName === "LaunchEconomics") newChildren.add(lc(log.args.treasury));
      if (log.eventName === "MintLaunch") newChildren.add(lc(log.args.emission));
    }
    const children = [...new Set([...knownBefore, ...newChildren])];
    const childLogs = children.length
      ? (await deps.getLogs(children as Address[], from, latest)).sort(order)
      : [];

    const swapBlocks = [...new Set(childLogs.filter((l) => l.eventName === "Swap" || l.eventName === "ReferrerBound").map((l) => l.blockNumber))];
    const timestamps = new Map<bigint, number>();
    for (const b of swapBlocks) timestamps.set(b, await deps.getBlockTimestamp(b));
    const ts = (b: bigint) => timestamps.get(b) ?? 0;

    pendingSymbols.length = 0;
    pendingTokens.length = 0;
    transaction((db) => {
      for (const log of factoryLogs) applyLog(log, ts);
      for (const log of childLogs) applyLog(log, ts);
      const upsert = db.prepare(
        `INSERT INTO indexer_progress VALUES (?, ?, ?)
         ON CONFLICT(chain_id, contract_address) DO UPDATE SET indexed_block = excluded.indexed_block`,
      );
      upsert.run(chainId, factory, latest.toString());
      for (const c of children) upsert.run(chainId, c, latest.toString());
    });

    // Backfill referral bind times that were stored before block timestamps were fetched.
    {
      const missing = getDb()
        .prepare("SELECT DISTINCT bound_block FROM referrals WHERE chain_id = ? AND (bound_at IS NULL OR bound_at = 0) AND bound_block IS NOT NULL")
        .all(chainId) as Array<{ bound_block: string }>;
      for (const m of missing) {
        const t = await deps.getBlockTimestamp(BigInt(m.bound_block)).catch(() => 0);
        if (t > 0) {
          getDb()
            .prepare("UPDATE referrals SET bound_at = ? WHERE chain_id = ? AND bound_block = ? AND (bound_at IS NULL OR bound_at = 0)")
            .run(t, chainId, m.bound_block);
        }
      }
    }

    if (deps.readSymbol) {
      for (const asset of pendingSymbols) {
        const symbol = await deps.readSymbol(asset as Address).catch(() => null);
        if (symbol) getDb().prepare("UPDATE quote_assets SET symbol = ? WHERE chain_id = ? AND address = ?").run(symbol, chainId, asset);
      }
    }
    if (deps.readTokenMeta) {
      for (const token of pendingTokens) {
        const meta = await deps.readTokenMeta(token as Address).catch(() => null);
        if (meta) setLaunch(token, { token_name: meta.name, token_symbol: meta.symbol });
      }
    }
    return latest;
  };

  const listLaunches = (): LaunchRow[] =>
    getDb().prepare("SELECT * FROM launches WHERE chain_id = ? ORDER BY launch_id DESC").all(chainId) as unknown as LaunchRow[];

  const getLaunch = (token: string): LaunchRow | null => launchBy("token", token.toLowerCase()) ?? null;

  const listQuoteAssets = () =>
    getDb().prepare("SELECT * FROM quote_assets WHERE chain_id = ? ORDER BY address").all(chainId) as Array<{
      address: string;
      allowed: number;
      freezable: number;
      decimals: number;
      min_fdv: string;
      max_fdv: string;
      symbol: string | null;
    }>;

  const listSwaps = (pool: string, beforeBlock: bigint | null, limit: number): SwapRecord[] => {
    const rows = getDb()
      .prepare(
        `SELECT * FROM swaps WHERE chain_id = ? AND pool = ? ${beforeBlock !== null ? "AND CAST(block_number AS INTEGER) < ?" : ""}
         ORDER BY CAST(block_number AS INTEGER) DESC, log_index DESC LIMIT ?`,
      )
      .all(...(beforeBlock !== null ? [chainId, pool.toLowerCase(), Number(beforeBlock), limit] : [chainId, pool.toLowerCase(), limit])) as any[];
    return rows.map((r) => ({
      pool: r.pool,
      blockNumber: Number(r.block_number),
      logIndex: r.log_index,
      txHash: r.tx_hash,
      timestamp: r.ts,
      trader: r.trader,
      recipient: r.recipient,
      isBuy: r.is_buy === 1,
      amountIn: r.amount_in,
      amountOut: r.amount_out,
      feeQuote: r.fee_quote,
      reserveQuote: r.reserve_quote,
      reserveToken: r.reserve_token,
    }));
  };

  const swapsSince = (pool: string, since: number) =>
    getDb()
      .prepare("SELECT ts, is_buy, amount_in, amount_out, fee_quote, reserve_quote, reserve_token FROM swaps WHERE chain_id = ? AND pool = ? AND ts >= ? ORDER BY CAST(block_number AS INTEGER), log_index")
      .all(chainId, pool.toLowerCase(), since) as Array<{
      ts: number;
      is_buy: number;
      amount_in: string;
      amount_out: string;
      fee_quote: string;
      reserve_quote: string;
      reserve_token: string;
    }>;

  const getSubscription = (token: string, account: string) =>
    (getDb()
      .prepare("SELECT * FROM subscriptions WHERE chain_id = ? AND token = ? AND account = ?")
      .get(chainId, token.toLowerCase(), account.toLowerCase()) as any) ?? null;

  const listEpochs = (token: string) =>
    getDb()
      .prepare("SELECT * FROM reward_epochs WHERE chain_id = ? AND token = ? ORDER BY asset, epoch")
      .all(chainId, token.toLowerCase()) as Array<{
      asset: string;
      epoch: number;
      root: string;
      total: string;
      claimed: string;
      claimable_at: number;
      data_uri: string;
    }>;

  const listInvitees = (referrer: string) =>
    getDb()
      .prepare(
        `SELECT account, referrer, bound_at, bound_block, tx_hash FROM referrals
         WHERE chain_id = ? AND referrer = ? ORDER BY bound_at ASC`,
      )
      .all(chainId, referrer.toLowerCase()) as Array<{
      account: string;
      referrer: string;
      bound_at: number;
      bound_block: string;
      tx_hash: string;
    }>;

  const getReferrer = (account: string) =>
    (getDb()
      .prepare(`SELECT account, referrer, bound_at, bound_block, tx_hash FROM referrals WHERE chain_id = ? AND account = ?`)
      .get(chainId, account.toLowerCase()) as
      | { account: string; referrer: string; bound_at: number; bound_block: string; tx_hash: string }
      | undefined) ?? null;

  return {
    sync,
    getIndexedBlock,
    listLaunches,
    getLaunch,
    listQuoteAssets,
    listSwaps,
    swapsSince,
    getSubscription,
    listEpochs,
    listInvitees,
    getReferrer,
  };
}

export type Indexer = ReturnType<typeof createIndexer>;
