import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { Address, Hex } from "viem";
import {
  addressSchema,
  allocation,
  buildWhitelist,
  copyUploadSchema,
  hashLaunchCopy,
  whitelistListHash,
  whitelistUploadSchema,
  type Launch,
  type LaunchCopyContent,
  type SalePhase,
} from "@portus/shared";
import type { Indexer, LaunchRow } from "./indexer.js";
import { rowToFacts } from "./indexer.js";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { aggregateCandles, INTERVALS, type Interval } from "./candles.js";
import { buildZones } from "./mint-zones.js";
import {
  NonceAlreadyUsedError,
  type LaunchCopyRow,
  type NonceUse,
  type WhitelistRow,
} from "./db.js";

export interface AppDependencies {
  chainId: number;
  chainName: string;
  explorerUrl: string | null;
  factory: Address;
  indexer: Indexer;
  syncIndex(): Promise<boolean>;
  now(): number;
  deploymentMismatch(): string | null;
  readSubscription(sale: Address, account: Address): Promise<{
    committed: string;
    whitelistCommitted: string;
    publicCommitted: string;
    claimed: boolean;
    previewTokens: string;
    previewRefund: string;
  }>;
  verifyCopyAuthorization(input: {
    creator: Address;
    token: Address;
    copy: LaunchCopyContent;
    nonce: Hex;
    signature: Hex;
    chainId: number;
    factory: Address;
  }): Promise<boolean>;
  verifyWhitelistAuthorization(input: {
    creator: Address;
    token: Address;
    root: Hex;
    listHash: Hex;
    nonce: Hex;
    signature: Hex;
    chainId: number;
    factory: Address;
  }): Promise<boolean>;
  getCopy(chainId: number, token: string): LaunchCopyRow | null;
  allCopy(chainId: number): Map<string, LaunchCopyRow>;
  consumeNonceAndUpsertCopy(chainId: number, row: LaunchCopyRow, nonce: NonceUse): void;
  consumeNonceAndReplaceWhitelist(chainId: number, token: string, entries: WhitelistRow[], nonce: NonceUse): void;
  getWhitelistEntry(chainId: number, token: string, account: string): WhitelistRow | null;
  whitelistCount(chainId: number, token: string): number;
  /** Directory the reward publisher writes epoch datasets into (REWARDS_DIR). */
  rewardsDir?: string;
  readEconomics?(l: { token: Address; pool: Address; treasury: Address | null; quoteAsset: Address }): Promise<Record<string, unknown>>;
  readMint?(l: { token: Address; emission: Address }): Promise<Record<string, unknown>>;
  readOwed?(account: Address, assets: Address[]): Promise<Array<{ asset: Address; owed: string }>>;
  readClaimed?(token: Address, asset: Address, epoch: number, account: Address): Promise<boolean>;
  readFlywheel?(
    asset: Address,
  ): Promise<{ round: number; start: number; active: boolean; nominated: Array<{ pool: string; marketCap: string }>; budget: string } | null>;
  /** Live ERC-20 balances for invite zone holdings (optional). */
  readBalances?(token: Address, accounts: Address[]): Promise<Map<string, bigint>>;
}

/**
 * Shown when the creator has not uploaded copy: the token's own on-chain name
 * and symbol (still creator-chosen, so still rendered as untrusted). Never
 * invents a description: it stays empty and the front end says so.
 */
function fallbackCopy(row: Pick<LaunchRow, "launch_id" | "token_name" | "token_symbol">) {
  return {
    name: row.token_name ?? `Launch #${row.launch_id}`,
    symbol: row.token_symbol ?? "???",
    description: "",
    docsUrl: null,
    imageUrl: null,
  };
}

const ZERO32 = `0x${"0".repeat(64)}`;

async function readJson(c: { req: { json(): Promise<unknown> } }): Promise<unknown | undefined> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

export function createApp(deps: AppDependencies) {
  const app = new Hono();
  app.use("/*", cors());

  const quoteInfo = () =>
    new Map(
      deps.indexer.listQuoteAssets().map((q) => [q.address, { symbol: q.symbol, decimals: q.decimals, freezable: q.freezable === 1 }]),
    );

  const toLaunch = (row: LaunchRow, copy: LaunchCopyRow | null | undefined, quotes: ReturnType<typeof quoteInfo>): Launch => ({
    ...rowToFacts(row, deps.now(), Number(deps.indexer.getIndexedBlock())),
    kind: row.mint_config ? "MINT" : "STANDARD",
    quote: quotes.get(row.quote_asset) ?? null,
    copy: copy
      ? { name: copy.name, symbol: copy.symbol, description: copy.description, docsUrl: copy.docs_url, imageUrl: copy.image_url }
      : fallbackCopy(row),
  });

  /** Sync, then report staleness instead of failing: the chain is still the truth. */
  const synced = async (c: { header(name: string, value: string): void }) => {
    const ok = await deps.syncIndex();
    if (!ok) c.header("x-portus-index", "stale");
    return ok;
  };

  const tokenParam = (raw: string) => addressSchema.safeParse(raw);

  app.get("/health", async (c) => {
    const ok = await deps.syncIndex();
    return c.json({
      ok: true,
      indexOk: ok,
      chainId: deps.chainId,
      chainName: deps.chainName,
      explorerUrl: deps.explorerUrl,
      factory: deps.factory,
      indexedBlock: Number(deps.indexer.getIndexedBlock()),
      chainTime: deps.now(),
      deploymentMismatch: deps.deploymentMismatch(),
      time: new Date().toISOString(),
    });
  });

  app.get("/quote-assets", async (c) => {
    await synced(c);
    return c.json(
      deps.indexer.listQuoteAssets().map((q) => ({
        address: q.address,
        symbol: q.symbol,
        decimals: q.decimals,
        allowed: q.allowed === 1,
        freezable: q.freezable === 1,
        minFdv: q.min_fdv,
        maxFdv: q.max_fdv,
      })),
    );
  });

  app.get("/launches", async (c) => {
    await synced(c);
    const phase = c.req.query("phase") as SalePhase | undefined;
    const quote = c.req.query("quote")?.toLowerCase();
    const cursor = c.req.query("cursor");
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
    const copy = deps.allCopy(deps.chainId);
    const quotes = quoteInfo();
    let rows = deps.indexer.listLaunches();
    // Display-only hide list (e.g. old test launches). Detail, rewards, /me (includeHidden=1) and keeper are unaffected.
    if (c.req.query("includeHidden") !== "1") {
      const hidden = new Set((process.env.HIDDEN_LAUNCHES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
      if (hidden.size) rows = rows.filter((r) => !hidden.has(r.token.toLowerCase()));
    }
    if (cursor !== undefined) rows = rows.filter((r) => r.launch_id < Number(cursor));
    if (quote) rows = rows.filter((r) => r.quote_asset === quote);
    let launches = rows.map((r) => toLaunch(r, copy.get(r.token), quotes));
    if (phase) launches = launches.filter((l) => l.phase === phase);
    const page = launches.slice(0, limit);
    const next = launches.length > limit ? page[page.length - 1]!.launchId : null;
    return c.json({ launches: page, nextCursor: next });
  });

  app.get("/launches/:token", async (c) => {
    const token = tokenParam(c.req.param("token"));
    if (!token.success) return c.json({ error: "bad token address" }, 400);
    await synced(c);
    const row = deps.indexer.getLaunch(token.data);
    if (!row) return c.json({ error: "not found" }, 404);
    const mintConfig = row.mint_config ? (JSON.parse(row.mint_config) as Record<string, unknown> & { emission: string }) : null;
    const mintLive =
      mintConfig && deps.readMint
        ? await deps.readMint({ token: row.token as Address, emission: mintConfig.emission as Address }).catch(() => null)
        : null;
    const live =
      !mintConfig && deps.readEconomics && row.outcome !== 0
        ? await deps
            .readEconomics({
              token: row.token as Address,
              pool: row.pool as Address,
              treasury: (row.treasury ?? null) as Address | null,
              quoteAsset: row.quote_asset as Address,
            })
            .catch(() => null)
        : null;
    return c.json({
      ...toLaunch(row, deps.getCopy(deps.chainId, row.token), quoteInfo()),
      whitelistUploaded: deps.whitelistCount(deps.chainId, row.token),
      feesQuote: row.fees_quote,
      dustSwept: row.dust_swept === 1,
      kind: mintConfig ? "MINT" : "STANDARD",
      mint: mintConfig
        ? { ...mintConfig, mintedTotal: row.minted_total, taxBurned: row.tax_burned, taxPaid: row.tax_paid, live: mintLive }
        : null,
      economics: {
        treasury: row.treasury,
        creatorRecipient: row.creator_recipient,
        treasuryMode: row.treasury_mode === 1 ? "REWARDS" : "BUYBACK",
        releaseMode: row.release_mode === 1 ? "DECAYING" : "LINEAR",
        releaseRateBps: row.release_rate_bps,
        incentiveStart: row.incentive_start,
        feesSplit: {
          ecosystem: row.fees_ecosystem,
          flywheel: row.fees_flywheel,
          creator: row.fees_creator,
          treasury: row.fees_treasury,
        },
        buyback: { quoteSpent: row.buyback_quote, tokensBurned: row.buyback_burned },
        flywheel: { quoteSpent: row.flywheel_quote, tokensBurned: row.flywheel_burned },
        rewardsFunded: row.rewards_funded,
        epochs: deps.indexer.listEpochs(row.token),
        live,
      },
    });
  });

  app.get("/launches/:token/subscription/:account", async (c) => {
    const token = tokenParam(c.req.param("token"));
    const account = addressSchema.safeParse(c.req.param("account"));
    if (!token.success || !account.success) return c.json({ error: "bad address" }, 400);
    await synced(c);
    const row = deps.indexer.getLaunch(token.data);
    if (!row) return c.json({ error: "not found" }, 404);
    // The account's own position comes straight from the sale contract.
    const live = await deps.readSubscription(row.sale as Address, account.data);
    const facts = rowToFacts(row, deps.now(), 0);
    // What this account would receive under each possible outcome, from the
    // same math the contract uses (shared/pricing.ts).
    const committed = BigInt(live.committed);
    const total = BigInt(row.total_committed);
    const terms = {
      raiseTarget: BigInt(row.raise_target),
      qSale: BigInt(row.q_sale),
      priceNum: BigInt(row.price_num),
      priceDen: BigInt(row.price_den),
    };
    const scenario = (o: "FILLED" | "SHRUNK" | "REFUNDED") => {
      const r = allocation(committed, o === "FILLED" && total < terms.raiseTarget ? terms.raiseTarget : total, o, terms);
      return { tokens: r.tokens.toString(), refund: r.refund.toString() };
    };
    return c.json({
      token: row.token,
      account: account.data,
      phase: facts.phase,
      ...live,
      scenarios: committed > 0n ? { FILLED: scenario("FILLED"), SHRUNK: scenario("SHRUNK"), REFUNDED: scenario("REFUNDED") } : null,
    });
  });

  app.get("/launches/:token/whitelist/:account", async (c) => {
    const token = tokenParam(c.req.param("token"));
    const account = addressSchema.safeParse(c.req.param("account"));
    if (!token.success || !account.success) return c.json({ error: "bad address" }, 400);
    const entry = deps.getWhitelistEntry(deps.chainId, token.data, account.data);
    if (!entry) return c.json({ error: "not on whitelist" }, 404);
    const row = deps.indexer.getLaunch(token.data);
    // Clients must re-verify against the on-chain root; it is returned for that.
    return c.json({ account: entry.account, cap: entry.cap, proof: entry.proof, merkleRoot: row?.merkle_root ?? null });
  });

  app.put("/launches/:token/whitelist", async (c) => {
    const token = tokenParam(c.req.param("token"));
    if (!token.success) return c.json({ error: "bad token address" }, 400);
    const body = await readJson(c);
    if (body === undefined) return c.json({ error: "invalid JSON" }, 400);
    const parsed = whitelistUploadSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: z.treeifyError(parsed.error) }, 400);
    await synced(c);
    const row = deps.indexer.getLaunch(token.data);
    if (!row) return c.json({ error: "no such launch on chain" }, 404);
    if (row.merkle_root === ZERO32) return c.json({ error: "this launch has no whitelist" }, 409);

    const entries = parsed.data.entries.map((e) => ({ account: e.account as Address, cap: BigInt(e.cap) }));
    let tree;
    try {
      tree = buildWhitelist(entries);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
    // The list must reproduce the root fixed on-chain, and the root and list
    // hash the creator signed.
    if (tree.root.toLowerCase() !== row.merkle_root) return c.json({ error: "list does not match the on-chain merkleRoot" }, 422);
    if (parsed.data.root.toLowerCase() !== row.merkle_root) return c.json({ error: "signed root does not match the on-chain merkleRoot" }, 422);
    if (whitelistListHash(entries).toLowerCase() !== parsed.data.listHash.toLowerCase()) {
      return c.json({ error: "listHash does not match the entries" }, 422);
    }

    const nonce = parsed.data.nonce as Hex;
    const valid = await deps
      .verifyWhitelistAuthorization({
        creator: row.creator as Address,
        token: row.token as Address,
        root: parsed.data.root as Hex,
        listHash: parsed.data.listHash as Hex,
        nonce,
        signature: parsed.data.signature as Hex,
        chainId: deps.chainId,
        factory: deps.factory,
      })
      .catch(() => false);
    if (!valid) return c.json({ error: "invalid creator authorization" }, 403);

    try {
      deps.consumeNonceAndReplaceWhitelist(
        deps.chainId,
        row.token,
        [...tree.entries.values()].map((e) => ({ account: e.account, cap: e.cap.toString(), proof: e.proof })),
        {
          chainId: deps.chainId,
          factory: deps.factory,
          signer: row.creator,
          nonce,
          kind: "whitelist",
          token: row.token,
          payloadHash: parsed.data.listHash,
        },
      );
    } catch (error) {
      if (error instanceof NonceAlreadyUsedError) return c.json({ error: error.message }, 409);
      throw error;
    }
    return c.json({ ok: true, count: entries.length });
  });

  app.put("/launches/:token/copy", async (c) => {
    const token = tokenParam(c.req.param("token"));
    if (!token.success) return c.json({ error: "bad token address" }, 400);
    const body = await readJson(c);
    if (body === undefined) return c.json({ error: "invalid JSON" }, 400);
    const parsed = copyUploadSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: z.treeifyError(parsed.error) }, 400);
    await synced(c);
    const row = deps.indexer.getLaunch(token.data);
    if (!row) return c.json({ error: "no such launch on chain" }, 404);

    const copy: LaunchCopyContent = {
      name: parsed.data.name,
      symbol: parsed.data.symbol,
      description: parsed.data.description,
      docsUrl: parsed.data.docsUrl ?? null,
      imageUrl: parsed.data.imageUrl ?? null,
    };
    const copyHash = hashLaunchCopy(copy);
    // If the creator pinned a hash on-chain, only that exact copy is accepted.
    if (row.metadata_hash !== ZERO32 && copyHash.toLowerCase() !== row.metadata_hash) {
      return c.json({ error: "copy does not match the on-chain metadataHash" }, 422);
    }
    const nonce = parsed.data.nonce as Hex;
    const valid = await deps
      .verifyCopyAuthorization({
        creator: row.creator as Address,
        token: row.token as Address,
        copy,
        nonce,
        signature: parsed.data.signature as Hex,
        chainId: deps.chainId,
        factory: deps.factory,
      })
      .catch(() => false);
    if (!valid) return c.json({ error: "invalid creator authorization" }, 403);

    try {
      deps.consumeNonceAndUpsertCopy(
        deps.chainId,
        {
          token: row.token,
          name: copy.name,
          symbol: copy.symbol,
          description: copy.description,
          docs_url: copy.docsUrl ?? null,
          image_url: copy.imageUrl ?? null,
          copy_hash: copyHash,
        },
        {
          chainId: deps.chainId,
          factory: deps.factory,
          signer: row.creator,
          nonce,
          kind: "copy",
          token: row.token,
          payloadHash: copyHash,
        },
      );
    } catch (error) {
      if (error instanceof NonceAlreadyUsedError) return c.json({ error: error.message }, 409);
      throw error;
    }
    return c.json({ ok: true });
  });

  /**
   * Every epoch dataset that pays `account` something for this launch, with
   * the Merkle proof and claim status. Datasets are the public files the
   * reward publisher wrote; claim status is read from the Distributor.
   */
  app.get("/launches/:token/rewards/:account", async (c) => {
    const token = tokenParam(c.req.param("token"));
    const account = addressSchema.safeParse(c.req.param("account"));
    if (!token.success || !account.success) return c.json({ error: "bad address" }, 400);
    await synced(c);
    const dir = deps.rewardsDir ? join(deps.rewardsDir, String(deps.chainId), token.data) : null;
    const out: Array<Record<string, unknown> & { epoch: number }> = [];
    if (dir && existsSync(dir)) {
      const epochs = deps.indexer.listEpochs(token.data);
      for (const asset of readdirSync(dir)) {
        for (const f of readdirSync(join(dir, asset))) {
          if (!f.endsWith(".json")) continue;
          const data = JSON.parse(readFileSync(join(dir, asset, f), "utf8")) as {
            kind: string;
            epoch: string;
            root: string;
            window: { from: number; to: number };
            entries: Array<{ account: string; amount: string; proof: string[]; components: Record<string, string> | null }>;
          };
          const entry = data.entries.find((e) => e.account.toLowerCase() === account.data);
          if (!entry) continue;
          const epoch = Number(data.epoch);
          const onchain = epochs.find((e) => e.asset === asset && e.epoch === epoch);
          // Only datasets whose root actually made it on-chain are claimable.
          if (!onchain || onchain.root.toLowerCase() !== data.root.toLowerCase()) continue;
          const claimed = deps.readClaimed
            ? await deps.readClaimed(token.data, asset as Address, epoch, account.data).catch(() => false)
            : false;
          out.push({
            asset,
            kind: data.kind,
            epoch,
            window: data.window,
            amount: entry.amount,
            proof: entry.proof,
            components: entry.components,
            claimableAt: onchain.claimable_at,
            claimed,
          });
        }
      }
    }
    out.sort((a, b) => a.epoch - b.epoch);
    return c.json({ rewards: out });
  });

  /** Fee shares an account (creator recipient, ecosystem, …) can pull from the FeeSplitter. */
  app.get("/accounts/:account/fees", async (c) => {
    const account = addressSchema.safeParse(c.req.param("account"));
    if (!account.success) return c.json({ error: "bad address" }, 400);
    await synced(c);
    const assets = deps.indexer.listQuoteAssets().map((q) => q.address as Address);
    const owed = deps.readOwed ? await deps.readOwed(account.data, assets) : [];
    return c.json({ owed: owed.filter((o) => o.owed !== "0") });
  });

  /**
   * Direct invitees who bound `account` as their referrer (single layer only).
   * Populated from Distributor ReferrerBound events.
   */
  app.get("/accounts/:account/invitees", async (c) => {
    const account = addressSchema.safeParse(c.req.param("account"));
    if (!account.success) return c.json({ error: "bad address" }, 400);
    await synced(c);
    const rows = deps.indexer.listInvitees(account.data);
    const upline = deps.indexer.getReferrer(account.data);
    return c.json({
      referrer: upline?.referrer ?? null,
      boundAt: upline?.bound_at ?? null,
      invitees: rows.map((r) => ({
        account: r.account,
        boundAt: r.bound_at,
        txHash: r.tx_hash,
      })),
      directCount: rows.length,
    });
  });

  /**
   * Mint-mode zones for one launch + referrer: each direct invitee is one zone
   * (live token balance as a UI proxy; daily rewards still use 24h TWAB).
   */
  app.get("/launches/:token/zones/:account", async (c) => {
    const token = tokenParam(c.req.param("token"));
    const account = addressSchema.safeParse(c.req.param("account"));
    if (!token.success || !account.success) return c.json({ error: "bad address" }, 400);
    await synced(c);
    const row = deps.indexer.getLaunch(token.data);
    if (!row) return c.json({ error: "not found" }, 404);
    const invitees = deps.indexer.listInvitees(account.data).map((r) => ({
      account: r.account,
      boundAt: r.bound_at as number | null,
      txHash: r.tx_hash as string | null,
    }));
    let holdingOf = new Map<string, bigint>();
    if (deps.readBalances && invitees.length > 0) {
      holdingOf = await deps.readBalances(
        token.data as Address,
        invitees.map((i) => i.account as Address),
      );
    }
    const built = buildZones(invitees, holdingOf);
    return c.json({
      token: token.data,
      account: account.data,
      mint: !!row.mint_config,
      holdingBasis: "live",
      note: "UI holdings are live balances; daily mint rewards use 24h TWAB.",
      ...built,
    });
  });

  app.get("/flywheel/:asset", async (c) => {
    const asset = addressSchema.safeParse(c.req.param("asset"));
    if (!asset.success) return c.json({ error: "bad address" }, 400);
    await synced(c);
    const fw = deps.readFlywheel ? await deps.readFlywheel(asset.data).catch(() => null) : null;
    if (!fw) return c.json({ error: "flywheel unavailable" }, 503);
    const byPool = new Map(deps.indexer.listLaunches().map((l) => [l.pool, l]));
    return c.json({
      ...fw,
      nominated: fw.nominated.map((n) => {
        const l = byPool.get(n.pool);
        return { ...n, token: l?.token ?? null, name: l?.token_name ?? null, symbol: l?.token_symbol ?? null };
      }),
    });
  });

  app.get("/launches/:token/swaps", async (c) => {
    const token = tokenParam(c.req.param("token"));
    if (!token.success) return c.json({ error: "bad token address" }, 400);
    await synced(c);
    const row = deps.indexer.getLaunch(token.data);
    if (!row) return c.json({ error: "not found" }, 404);
    const cursor = c.req.query("cursor");
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
    const swaps = deps.indexer.listSwaps(row.pool, cursor ? BigInt(cursor) : null, limit);
    return c.json({ swaps, nextCursor: swaps.length === limit ? swaps[swaps.length - 1]!.blockNumber : null });
  });

  app.get("/launches/:token/candles", async (c) => {
    const token = tokenParam(c.req.param("token"));
    if (!token.success) return c.json({ error: "bad token address" }, 400);
    const interval = (c.req.query("interval") ?? "5m") as Interval;
    if (!(interval in INTERVALS)) return c.json({ error: "interval must be one of 1m, 5m, 1h, 1d" }, 400);
    await synced(c);
    const row = deps.indexer.getLaunch(token.data);
    if (!row) return c.json({ error: "not found" }, 404);
    const since = deps.now() - INTERVALS[interval] * 500;
    return c.json({ interval, candles: aggregateCandles(deps.indexer.swapsSince(row.pool, since), interval) });
  });

  return app;
}
